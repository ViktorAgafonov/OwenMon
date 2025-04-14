// Основной JavaScript-файл для приложения OwenMon

// Глобальные переменные
let socket;
let currentData = {
    weight: 0,
    weightInt16: 0,
    status: 'disconnected',
    deviceStatus: 'stable',
    timestamp: new Date(),
    connectionInfo: {
        type: 'Modbus TCP',
        host: '',
        port: 502
    }
};
let hourlyData = [];
let settings = {};
// Добавляем переменную для отслеживания предыдущего веса и времени его измерения
let prevWeight = 0;
let prevWeightTimestamp = new Date();

// Инициализация приложения при загрузке страницы
$(document).ready(function() {
    // Проверка загрузки Bootstrap
    if (typeof bootstrap === 'undefined') {
        console.error('Bootstrap не загружен! Некоторые функции могут не работать.');
    }
    
    // Глобальная обработка ошибок AJAX запросов
    $(document).ajaxError(function(event, jqXHR, settings, thrownError) {
        console.error('AJAX ошибка:', thrownError, jqXHR.responseText);
    });
    
    // Обработка хэш-ссылок для навигации на вкладки
    const handleHashNavigation = function() {
        let targetPage = 'dashboard'; // Страница по умолчанию
        
        if (window.location.hash) {
            // Удаляем символ # из начала хэша
            const hash = window.location.hash.substring(1);
            if (hash && $(`a[data-page="${hash}"]`).length) {
                targetPage = hash;
            }
        }
        
        // Активируем соответствующую вкладку
        $(`a[data-page="${targetPage}"]`).trigger('click');
    };
    
    // Инициализация текущей даты в полях выбора даты
    const today = new Date().toISOString().split('T')[0];
    $('#hourly-date-picker').val(today);
    $('#shift-date-picker').val(today);
    $('#report-date').val(today);
    
    // Вызываем обработку хэш-ссылок при загрузке страницы
    handleHashNavigation();
    
    // Также обрабатываем изменение хэша в URL (когда пользователь использует навигацию браузера)
    $(window).on('hashchange', handleHashNavigation);
    
    // Обработчик переключения страниц
    $('a[data-page]').on('click', function(e) {
        e.preventDefault();
        
        // Получение ID страницы
        const pageId = $(this).data('page');
        
        console.log(`Переключение на страницу: ${pageId}`);
        
        // Обновление активного пункта меню
        $('a[data-page]').parent().removeClass('active');
        $(this).parent().addClass('active');
        
        // Удаляем хэш из URL, чтобы избежать проблем с навигацией
        if (window.location.hash) {
            history.pushState('', document.title, window.location.pathname + window.location.search);
        }
        
        // Скрытие всех страниц и отображение выбранной
        $('.content-page').removeClass('active');
        const pageElement = $(`#${pageId}-page`);
        if (pageElement.length) {
            pageElement.addClass('active');
            // Обновление заголовка страницы
            $('#page-title').text($(this).text().trim());
            // Загрузка данных для страницы
            loadPageData(pageId);
        } else {
            console.error(`Страница с ID ${pageId}-page не найдена в DOM`);
            alert(`Ошибка: страница "${$(this).text().trim()}" не найдена. Сообщите администратору.`);
        }
    });
    
    // Обработчик сворачивания/разворачивания бокового меню
    $('#sidebarCollapse').on('click', function() {
        $('#sidebar').toggleClass('active');
    });
    
    // Обработчик переключения типа подключения Modbus
    $('#connection-type').on('change', function() {
        const connectionType = $(this).val();
        
        if (connectionType === 'rtu') {
            $('#rtu-settings').show();
            $('#tcp-settings').hide();
        } else {
            $('#rtu-settings').hide();
            $('#tcp-settings').show();
        }
    });
    
    // Обработчик формы настроек Modbus
    $('#modbus-settings-form').on('submit', function(e) {
        e.preventDefault();
        
        // Сбор данных формы
        const connectionType = $('#connection-type').val();
        
        // Сбор настроек регистров
        const registers = {
            weight: parseInt($('#weight-register').val()) || 0,        // Регистр веса
            dispatch: parseInt($('#dispatch-register').val()) || 1,    // Регистр сигнала dispatch
            // Регистры входных танков
            dumpInputTank_1: parseInt($('#dump-input-tank-1').val()) || 2,
            dumpInputTank_2: parseInt($('#dump-input-tank-2').val()) || 3,
            dumpInputTank_3: parseInt($('#dump-input-tank-3').val()) || 4,
            // Регистры выходных танков
            outTank_1: parseInt($('#out-tank-1').val()) || 5,
            outTank_2: parseInt($('#out-tank-2').val()) || 6,
            outTank_3: parseInt($('#out-tank-3').val()) || 7
        };
        
        let modbusSettings = {
            connectionType,
            slaveId: parseInt($('#slave-id').val()) || 1,
            pollInterval: parseInt($('#poll-interval').val()) || 1000,
            registers: registers
        };
        
        // Добавление специфичных настроек в зависимости от типа подключения
        if (connectionType === 'rtu') {
            modbusSettings = {
                ...modbusSettings,
                port: $('#com-port').val() || 'COM1',
                baudRate: parseInt($('#baud-rate').val()) || 9600,
                dataBits: parseInt($('#data-bits').val()) || 8,
                stopBits: parseInt($('#stop-bits').val()) || 1,
                parity: $('#parity').val() || 'none'
            };
        } else {
            modbusSettings = {
                ...modbusSettings,
                host: $('#ip-address').val() || '192.168.1.100',
                port: parseInt($('#tcp-port').val()) || 502
            };
        }
        
        // Сохранение настроек на сервере
        saveSettings({ modbus: modbusSettings })
            .then(() => {
                alert('Настройки Modbus сохранены успешно');
            })
            .catch(error => {
                console.error('Ошибка сохранения настроек Modbus:', error);
                alert('Ошибка сохранения настроек: ' + error.message);
            });
    });
    
    // Обработчик формы настроек смен
    $('#shifts-settings-form').on('submit', function(e) {
        e.preventDefault();
        
        // Сбор данных о сменах
        const shifts = [];
        
        $('.shift-item').each(function(index) {
            const shiftIndex = index;
            const name = $(this).find(`.shift-name[data-shift="${shiftIndex}"]`).val() || `Смена ${index + 1}`;
            const startHour = parseInt($(this).find(`.shift-start[data-shift="${shiftIndex}"]`).val()) || 0;
            const endHour = parseInt($(this).find(`.shift-end[data-shift="${shiftIndex}"]`).val()) || 0;
            
            shifts.push({
                name,
                startHour,
                endHour
            });
        });
        
        // Сохранение настроек на сервере
        saveSettings({ shifts: { shifts } })
            .then(() => {
                alert('Настройки смен сохранены успешно');
            })
            .catch(error => {
                console.error('Ошибка сохранения настроек смен:', error);
                alert('Ошибка сохранения настроек: ' + error.message);
            });
    });
    
    // Обработчик формы корректировки веса силосов
    $('#tanks-weight-form').on('submit', function(e) {
        e.preventDefault();
        
        // Сбор данных о весах силосов
        const inputTanks = [
            {
                id: 1,
                name: 'Силос муки 1',
                initialWeight: parseInt($('#input-tank-1-weight').val()) || 0
            },
            {
                id: 2,
                name: 'Силос муки 2',
                initialWeight: parseInt($('#input-tank-2-weight').val()) || 0
            },
            {
                id: 3,
                name: 'Силос муки 3',
                initialWeight: parseInt($('#input-tank-3-weight').val()) || 0
            }
        ];
        
        const outputTanks = [
            {
                id: 1,
                name: 'Промежуточный 1',
                initialWeight: parseInt($('#output-tank-1-weight').val()) || 0
            },
            {
                id: 2,
                name: 'Промежуточный 2',
                initialWeight: parseInt($('#output-tank-2-weight').val()) || 0
            },
            {
                id: 3,
                name: 'Промежуточный 3',
                initialWeight: parseInt($('#output-tank-3-weight').val()) || 0
            }
        ];
        
        const reason = $('#correction-reason').val() || 'Корректировка веса';
        
        // Формирование данных для отправки
        const tanksWeightData = {
            tanks: {
                input: inputTanks,
                output: outputTanks
            },
            correction: {
                reason: reason,
                timestamp: new Date().toISOString()
            }
        };
        
        // Отправка данных на сервер
        fetch('/api/tanks/correction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tanksWeightData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Ошибка сохранения корректировки весов');
            }
            return response.json();
        })
        .then(data => {
            alert('Корректировка весов силосов успешно применена');
        })
        .catch(error => {
            console.error('Ошибка применения корректировки:', error);
            alert('Ошибка применения корректировки: ' + error.message);
        });
    });
    
    // Обработчик кнопки проверки подключения
    $('#test-connection').on('click', function() {
        // Отправка запроса на сервер для проверки подключения
        fetch('/api/modbus/test-connection')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Подключение успешно установлено');
                } else {
                    alert('Ошибка подключения: ' + data.error);
                }
            })
            .catch(error => {
                console.error('Ошибка проверки подключения:', error);
                alert('Ошибка проверки подключения');
            });
    });
    
    // Обработчик загрузки часовых архивов
    $('#load-hourly-archives').on('click', function() {
        const date = $('#hourly-date-picker').val();
        loadHourlyArchives(date);
    });
    
    // Обработчик загрузки архивов смен
    $('#load-shift-archives').on('click', function() {
        const date = $('#shift-date-picker').val();
        loadShiftArchives(date);
    });
    
    // Обработчик формы генерации отчета
    $('#report-form').on('submit', function(e) {
        e.preventDefault();
        
        const date = $('#report-date').val();
        const shift = $('#report-shift').val();
        
        // Формирование URL для скачивания отчета
        const reportUrl = `/api/report/shift?date=${date}&shift=${shift}`;
        
        // Открытие URL в новом окне для скачивания
        window.open(reportUrl, '_blank');
    });
    
    // Обработчик кнопки печати деталей архива
    $('#print-archive-details').on('click', function() {
        window.print();
    });
    
    // Инициализация WebSocket-соединения
    initWebSocket();
    
    // Загрузка настроек
    loadSettings();
    
    // Запуск обновления текущего времени
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // Проверка наличия и правильной работы модальных окон
    try {
        const modalElem = document.getElementById('archive-details-modal');
        if (modalElem) {
            console.log('Модальное окно найдено, проверка инициализации...');
            // Обработчик закрытия модального окна для дополнительной очистки
            $(modalElem).on('hidden.bs.modal', function () {
                console.log('Модальное окно закрыто');
                $('#archive-details-content').empty();
            });
        } else {
            console.warn('Модальное окно с ID archive-details-modal не найдено в DOM');
        }
    } catch (error) {
        console.error('Ошибка при инициализации модального окна:', error);
    }
    
    // Загрузка данных для начальной страницы (dashboard)
    loadPageData('dashboard');
});

// Инициализация WebSocket-соединения
function initWebSocket() {
    // Создание WebSocket-соединения
    socket = io();
    
    // Обработчик события подключения
    socket.on('connect', function() {
        console.log('WebSocket подключен');
    });
    
    // Обработчик события отключения
    socket.on('disconnect', function() {
        console.log('WebSocket отключен');
        updateConnectionStatus('disconnected');
    });
    
    // Добавляем переменную для отслеживания предыдущего состояния dispatch
    let prevDispatchState = 0;
    
    // Обработчик события получения текущих данных
    socket.on('currentData', function(data) {
        console.log('Получены новые данные:', data);
        
        // Проверяем, изменилось ли значение dispatch с 0 на 1
        const dispatchTriggered = prevDispatchState === 0 && data.dispatch === 1;
        
        // Сохраняем текущее состояние dispatch для следующего сравнения
        prevDispatchState = data.dispatch;
        
        // Определяем стабильность веса (меньше 1% изменения за секунду)
        const currentWeight = data.weightInt16 !== undefined ? data.weightInt16 : data.weight;
        const currentTime = new Date(data.timestamp);
        
        // Вычисляем разницу времени в секундах
        const timeDiff = (currentTime - prevWeightTimestamp) / 1000;
        
        // Вычисляем процент изменения веса за секунду
        if (timeDiff > 0 && prevWeight > 0) {
            const weightDiff = Math.abs(currentWeight - prevWeight);
            const percentChange = (weightDiff / prevWeight) * 100 / timeDiff;
            
            // Устанавливаем статус стабильности веса
            if (percentChange < 1) {
                data.deviceStatus = 'stable';
            } else {
                data.deviceStatus = 'unstable';
            }
            
            console.log(`Изменение веса: ${percentChange.toFixed(2)}% за секунду. Статус: ${data.deviceStatus}`);
        } else {
            // По умолчанию, если нет предыдущих данных
            data.deviceStatus = 'stable';
        }
        
        // Обновляем предыдущие значения веса и времени
        prevWeight = currentWeight;
        prevWeightTimestamp = currentTime;
        
        // Убедимся, что deviceStatus имеет значение
        if (data.deviceStatus === undefined || data.deviceStatus === null) {
            data.deviceStatus = 'stable';
        }
        
        // Обновление глобальных данных
        currentData = data;
        
        // Добавление данных в массив часовых данных ТОЛЬКО при срабатывании сигнала dispatch
        if (dispatchTriggered) {
            console.log('Зафиксировано событие разгрузки весовой платформы!');
            hourlyData.push({
                weight: data.weight,
                weightInt16: data.weightInt16,
                deviceStatus: data.deviceStatus,
                timestamp: new Date(data.timestamp),
                dispatch: true
            });
            
            // Ограничение размера массива часовых данных (хранение не более 1000 записей)
            if (hourlyData.length > 1000) {
                hourlyData.shift();
            }
        }
        
        // Обновление статуса подключения
        updateConnectionStatus(data.status);
        
        // Обновление панели мониторинга, если она активна
        if ($('#dashboard-page').hasClass('active')) {
            updateDashboard();
        }
    });
}

// Обновление статуса подключения
function updateConnectionStatus(status) {
    const statusElement = $('#connection-status');
    
    // Удаление всех классов статуса
    statusElement.removeClass('connected disconnected error');
    
    // Установка текста и класса в зависимости от статуса
    switch (status) {
        case 'connected':
            statusElement.text('Подключено');
            statusElement.addClass('connected');
            break;
        case 'disconnected':
            statusElement.text('Отключено');
            statusElement.addClass('disconnected');
            break;
        case 'error':
            statusElement.text('Ошибка');
            statusElement.addClass('error');
            break;
        default:
            statusElement.text('Неизвестно');
    }
}

// Обновление текущего времени
function updateCurrentTime() {
    const now = new Date();
    const formattedTime = now.toLocaleTimeString();
    $('#current-time').text(formattedTime);
}

// Загрузка данных для страницы
function loadPageData(pageId) {
    switch (pageId) {
        case 'dashboard':
            updateDashboard();
            break;
        case 'hourly-archives':
            loadHourlyArchives($('#hourly-date-picker').val());
            break;
        case 'shift-archives':
            loadShiftArchives($('#shift-date-picker').val());
            break;
        case 'reports':
            // Инициализация страницы отчетов
            // Устанавливаем текущую дату если она не установлена
            if (!$('#report-date').val()) {
                $('#report-date').val(new Date().toISOString().split('T')[0]);
            }
            break;
        case 'settings':
            loadSettings();
            break;
        default:
            console.warn(`Неизвестная страница: ${pageId}`);
    }
}

// Обновление панели мониторинга
function updateDashboard() {
    // Обновление отображения текущего веса
    $('#current-weight').text(currentData.weightInt16);
    
    // Отображение информации о подключении
    if (currentData.connectionInfo) {
        const connInfo = currentData.connectionInfo;
        const connInfoText = `${connInfo.type} - ${connInfo.host}:${connInfo.port}`;
        $('#connection-info').text(connInfoText);
    }
    
    // Обновление статуса веса
    const weightStatusElement = $('#weight-status');
    weightStatusElement.removeClass('stable unstable error');
    
    // Устанавливаем deviceStatus как 'stable', если он не определен
    const deviceStatus = currentData.deviceStatus || 'stable';
    weightStatusElement.text(getStatusText(deviceStatus));
    weightStatusElement.addClass(deviceStatus);
    
    // Обновление времени последнего измерения
    if (currentData.timestamp) {
        const timestamp = new Date(currentData.timestamp);
        $('#weight-timestamp').text(timestamp.toLocaleTimeString());
    }
    
    // Расчет статистики за текущий час
    const hourlyStats = calculateHourlyStats();
    
    // Фильтруем операции разгрузки для отображения статистики
    const dispatchOperations = hourlyData.filter(item => item.dispatch === true);
    
    // Обновление статистики
    $('#hour-count').text(dispatchOperations.length);
    $('#hour-sum').text(Math.round(hourlyStats.sum) + ' кг');
    $('#hour-min').text(hourlyStats.min + ' кг');
    $('#hour-max').text(hourlyStats.max + ' кг');
    $('#hour-avg').text(Math.round(hourlyStats.avg) + ' кг');
    
    // Обновление таблицы последних измерений
    updateRecentMeasurements();
}

// Получение текстового представления статуса
function getStatusText(status) {
    // Проверка на undefined и null
    if (status === undefined || status === null) {
        return 'Стабильно'; // Значение по умолчанию
    }
    
    switch (status) {
        case 'stable':
            return 'Стабильно';
        case 'unstable':
            return 'Нестабильно';
        case 'overload':
            return 'Перегрузка';
        case 'error':
            return 'Ошибка';
        default:
            return 'Стабильно'; // Возвращаем стабильно вместо "Неизвестно"
    }
}

// Расчет статистики за текущий час
function calculateHourlyStats() {
    // Фильтруем только операции с dispatch: true
    const dispatchOperations = hourlyData.filter(item => item.dispatch === true);
    
    if (dispatchOperations.length === 0) {
        return {
            min: 0,
            max: 0,
            avg: 0,
            sum: 0
        };
    }
    
    // Используем weightInt16 если доступно, иначе weight для каждого элемента
    const weights = dispatchOperations.map(item => 
        item.weightInt16 !== undefined ? item.weightInt16 : item.weight
    );
    
    return {
        min: Math.min(...weights),
        max: Math.max(...weights),
        avg: weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
        sum: weights.reduce((sum, weight) => sum + weight, 0)
    };
}

// Обновление таблицы последних измерений
function updateRecentMeasurements() {
    const tableBody = $('#recent-measurements');
    tableBody.empty();
    
    // Получение последних 10 операций взвешивания (тех, которые имеют параметр dispatch: true)
    const weighingOperations = hourlyData.filter(item => item.dispatch === true);
    const recentOperations = weighingOperations.slice(-10).reverse();
    
    // Заголовок таблицы должен чётко указывать, что это операции взвешивания
    $('#recent-measurements-title').text('История операций взвешивания');
    
    // Добавление строк в таблицу
    recentOperations.forEach(measurement => {
        const time = new Date(measurement.timestamp).toLocaleTimeString();
        
        // Обеспечиваем, что всегда есть корректный статус
        const deviceStatus = measurement.deviceStatus || 'stable';
        const status = getStatusText(deviceStatus);
        
        const row = `
            <tr>
                <td>${time}</td>
                <td>${measurement.weightInt16} кг</td>
                <td>${status}</td>
                <td><span class="badge bg-success">Разгрузка</span></td>
            </tr>
        `;
        
        tableBody.append(row);
    });
    
    // Если данных нет, добавление сообщения
    if (recentOperations.length === 0) {
        tableBody.append('<tr><td colspan="4" class="text-center">Нет зарегистрированных операций взвешивания</td></tr>');
    }
}

// Загрузка часовых архивов
function loadHourlyArchives(date) {
    fetch(`/api/archives/hourly?date=${date}`)
        .then(response => response.json())
        .then(data => {
            const tableBody = $('#hourly-archives-list');
            tableBody.empty();
            
            if (data.length === 0) {
                tableBody.append('<tr><td colspan="7" class="text-center">Нет данных за выбранную дату</td></tr>');
                return;
            }
            
            // Сортировка данных по времени (от раннего к позднему)
            data.sort((a, b) => {
                return new Date(a.startTime) - new Date(b.startTime);
            });
            
            // Добавление строк в таблицу
            data.forEach(archive => {
                const hour = archive.hour;
                const count = archive.count;
                const sum = Math.round(archive.stats.sum);
                const avg = Math.round(archive.stats.avg);
                const min = archive.stats.min;
                const max = archive.stats.max;
                
                const row = `
                    <tr>
                        <td>${hour}:00</td>
                        <td>${count}</td>
                        <td>${sum}</td>
                        <td>${avg}</td>
                        <td>${min}</td>
                        <td>${max}</td>
                        <td>
                            <button class="btn btn-sm btn-primary view-archive-details" data-archive-type="hourly" data-date="${date}" data-hour="${hour}">
                                <i class="bi bi-eye"></i> Просмотр
                            </button>
                        </td>
                    </tr>
                `;
                
                tableBody.append(row);
            });
            
            // Добавление обработчиков для кнопок просмотра деталей
            $('.view-archive-details[data-archive-type="hourly"]').on('click', function() {
                const date = $(this).data('date');
                const hour = $(this).data('hour');
                showHourlyArchiveDetails(date, hour, data);
            });
        })
        .catch(error => {
            console.error('Ошибка загрузки часовых архивов:', error);
            $('#hourly-archives-list').html('<tr><td colspan="7" class="text-center text-danger">Ошибка загрузки данных</td></tr>');
        });
}

// Загрузка архивов смен
function loadShiftArchives(date) {
    fetch(`/api/archives/shifts?date=${date}`)
        .then(response => response.json())
        .then(data => {
            const tableBody = $('#shift-archives-list');
            tableBody.empty();
            
            if (data.length === 0) {
                tableBody.append('<tr><td colspan="8" class="text-center">Нет данных за выбранную дату</td></tr>');
                return;
            }
            
            // Сортировка данных по номеру смены
            data.sort((a, b) => a.shift - b.shift);
            
            // Добавление строк в таблицу
            data.forEach(archive => {
                const shift = archive.shift;
                const startTime = new Date(archive.startTime).toLocaleTimeString();
                const endTime = new Date(archive.endTime).toLocaleTimeString();
                const timeRange = `${startTime} - ${endTime}`;
                
                // Расчет общего количества измерений
                const count = archive.hourlyData.reduce((sum, hour) => sum + hour.count, 0);
                
                const sum = Math.round(archive.stats.sum);
                const avg = Math.round(archive.stats.avg);
                const min = archive.stats.min;
                const max = archive.stats.max;
                
                const row = `
                    <tr>
                        <td>${shift}</td>
                        <td>${timeRange}</td>
                        <td>${count}</td>
                        <td>${sum}</td>
                        <td>${avg}</td>
                        <td>${min}</td>
                        <td>${max}</td>
                        <td>
                            <button class="btn btn-sm btn-primary view-archive-details" data-archive-type="shift" data-date="${date}" data-shift="${shift}">
                                <i class="bi bi-eye"></i> Просмотр
                            </button>
                            <a href="/api/report/shift?date=${date}&shift=${shift}" class="btn btn-sm btn-success" target="_blank">
                                <i class="bi bi-file-earmark-excel"></i> Отчет
                            </a>
                        </td>
                    </tr>
                `;
                
                tableBody.append(row);
            });
            
            // Добавление обработчиков для кнопок просмотра деталей
            $('.view-archive-details[data-archive-type="shift"]').on('click', function() {
                const date = $(this).data('date');
                const shift = $(this).data('shift');
                showShiftArchiveDetails(date, shift, data);
            });
        })
        .catch(error => {
            console.error('Ошибка загрузки архивов смен:', error);
            $('#shift-archives-list').html('<tr><td colspan="8" class="text-center text-danger">Ошибка загрузки данных</td></tr>');
        });
}

// Отображение деталей часового архива
function showHourlyArchiveDetails(date, hour, archives) {
    // Поиск нужного архива
    const archive = archives.find(a => a.hour == hour);
    
    if (!archive) {
        alert('Архив не найден');
        return;
    }
    
    // Заполнение модального окна
    const modalTitle = $('.modal-title');
    modalTitle.text(`Архив за ${date} ${hour}:00`);
    
    const modalBody = $('#archive-details-content');
    modalBody.empty();
    
    // Добавление данных в таблицу
    archive.data.forEach(measurement => {
        const time = new Date(measurement.timestamp).toLocaleTimeString();
        // Обеспечиваем, что всегда есть корректный статус
        const deviceStatus = measurement.deviceStatus || 'stable';
        const status = getStatusText(deviceStatus);
        // Используем weightInt16 если доступно, иначе weight
        const weight = measurement.weightInt16 !== undefined ? measurement.weightInt16 : measurement.weight;
        
        const row = `
            <tr>
                <td>${time}</td>
                <td>${weight}</td>
                <td>${status}</td>
            </tr>
        `;
        
        modalBody.append(row);
    });
    
    // Отображение модального окна
    try {
        const modalElement = document.getElementById('archive-details-modal');
        if (modalElement) {
            // Используем Bootstrap 5 Modal API
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        } else {
            console.error('Модальное окно не найдено в DOM');
            alert('Ошибка отображения деталей. Проверьте консоль.');
        }
    } catch (error) {
        console.error('Ошибка отображения модального окна:', error);
        alert('Ошибка отображения деталей. Проверьте консоль.');
    }
}

// Отображение деталей архива смены
function showShiftArchiveDetails(date, shift, archives) {
    // Поиск нужного архива
    const archive = archives.find(a => a.shift == shift);
    
    if (!archive) {
        alert('Архив не найден');
        return;
    }
    
    // Заполнение модального окна
    const modalTitle = $('.modal-title');
    modalTitle.text(`Архив смены ${shift} за ${date}`);
    
    const modalBody = $('#archive-details-content');
    modalBody.empty();
    
    // Сбор всех измерений из часовых архивов
    const allMeasurements = [];
    
    archive.hourlyData.forEach(hourData => {
        hourData.data.forEach(measurement => {
            allMeasurements.push(measurement);
        });
    });
    
    // Сортировка по времени
    allMeasurements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Добавление данных в таблицу
    allMeasurements.forEach(measurement => {
        const time = new Date(measurement.timestamp).toLocaleString();
        // Обеспечиваем, что всегда есть корректный статус
        const deviceStatus = measurement.deviceStatus || 'stable';
        const status = getStatusText(deviceStatus);
        // Используем weightInt16 если доступно, иначе weight
        const weight = measurement.weightInt16 !== undefined ? measurement.weightInt16 : measurement.weight;
        
        const row = `
            <tr>
                <td>${time}</td>
                <td>${weight}</td>
                <td>${status}</td>
            </tr>
        `;
        
        modalBody.append(row);
    });
    
    // Отображение модального окна
    try {
        const modalElement = document.getElementById('archive-details-modal');
        if (modalElement) {
            // Используем Bootstrap 5 Modal API
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        } else {
            console.error('Модальное окно не найдено в DOM');
            alert('Ошибка отображения деталей. Проверьте консоль.');
        }
    } catch (error) {
        console.error('Ошибка отображения модального окна:', error);
        alert('Ошибка отображения деталей. Проверьте консоль.');
    }
}

// Загрузка настроек
function loadSettings() {
    fetch('/api/config')
        .then(response => response.json())
        .then(data => {
            // Сохранение настроек в глобальной переменной
            settings = data;
            
            // Заполнение формы настроек Modbus
            if (data.modbus) {
                const modbus = data.modbus;
                
                // Установка типа подключения
                $('#connection-type').val(modbus.connectionType || 'tcp');
                
                // Отображение соответствующих настроек
                if (modbus.connectionType === 'tcp') {
                    $('#rtu-settings').hide();
                    $('#tcp-settings').show();
                } else {
                    $('#rtu-settings').show();
                    $('#tcp-settings').hide();
                }
                
                // Заполнение общих настроек
                $('#slave-id').val(modbus.slaveId || 1);
                $('#poll-interval').val(modbus.pollInterval || 1000);
                
                // Заполнение настроек регистров
                const registers = modbus.registers || {};
                $('#weight-register').val(registers.weight || 0);
                $('#dispatch-register').val(registers.dispatch || 1);
                $('#dump-input-tank-1').val(registers.dumpInputTank_1 || 2);
                $('#dump-input-tank-2').val(registers.dumpInputTank_2 || 3);
                $('#dump-input-tank-3').val(registers.dumpInputTank_3 || 4);
                $('#out-tank-1').val(registers.outTank_1 || 5);
                $('#out-tank-2').val(registers.outTank_2 || 6);
                $('#out-tank-3').val(registers.outTank_3 || 7);
                
                // Заполнение настроек RTU
                $('#com-port').val(modbus.port || 'COM1');
                $('#baud-rate').val(modbus.baudRate || 9600);
                $('#data-bits').val(modbus.dataBits || 8);
                $('#stop-bits').val(modbus.stopBits || 1);
                $('#parity').val(modbus.parity || 'none');
                
                // Заполнение настроек TCP
                $('#ip-address').val(modbus.host || '192.168.1.100');
                $('#tcp-port').val(modbus.port || 502);
            }
            
            // Заполнение настроек смен
            if (data.shifts && data.shifts.shifts) {
                const shifts = data.shifts.shifts;
                
                shifts.forEach((shift, index) => {
                    $(`.shift-name[data-shift="${index}"]`).val(shift.name);
                    $(`.shift-start[data-shift="${index}"]`).val(shift.startHour);
                    $(`.shift-end[data-shift="${index}"]`).val(shift.endHour);
                });
            }
            
            // Загрузка текущих весов силосов
            loadTanksWeights();
        })
        .catch(error => {
            console.error('Ошибка загрузки настроек:', error);
        });
}

// Загрузка текущих весов силосов
function loadTanksWeights() {
    fetch('/api/tanks/state')
        .then(response => response.json())
        .then(data => {
            if (data.tanks) {
                // Заполнение полей входных силосов
                if (data.tanks.input) {
                    $('#input-tank-1-weight').val(Math.round(data.tanks.input.tank1 ? data.tanks.input.tank1.currentWeight : 0));
                    $('#input-tank-2-weight').val(Math.round(data.tanks.input.tank2 ? data.tanks.input.tank2.currentWeight : 0));
                    $('#input-tank-3-weight').val(Math.round(data.tanks.input.tank3 ? data.tanks.input.tank3.currentWeight : 0));
                }
                
                // Заполнение полей выходных танков
                if (data.tanks.output) {
                    $('#output-tank-1-weight').val(Math.round(data.tanks.output.tank1 ? data.tanks.output.tank1.currentWeight : 0));
                    $('#output-tank-2-weight').val(Math.round(data.tanks.output.tank2 ? data.tanks.output.tank2.currentWeight : 0));
                    $('#output-tank-3-weight').val(Math.round(data.tanks.output.tank3 ? data.tanks.output.tank3.currentWeight : 0));
                }
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки весов силосов:', error);
        });
}

// Сохранение настроек
function saveSettings(settingsData) {
    return fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settingsData)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Ошибка сохранения настроек');
        }
        return response.json();
    });
}
