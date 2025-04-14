// JavaScript для работы с танками и операциями перемещения

// Глобальные переменные
let tanksData = {
    input: {},
    output: {},
    platform: {
        weight: 0,
        dispatch: 0
    }
};

// Инициализация при загрузке страницы
$(document).ready(function() {
    // Обработчики событий для страницы танков
    $('#load-transfers').on('click', function() {
        const date = $('#transfers-date-picker').val();
        loadTransferOperations(date);
    });
    
    // Обработчики для формы отчета по танку
    $('#tank-report-form').on('submit', function(e) {
        e.preventDefault();
        
        const tankType = $('#tank-type').val();
        const tankId = $('#tank-id').val();
        const startDate = $('#tank-report-start-date').val();
        const endDate = $('#tank-report-end-date').val();
        
        // Формирование URL для скачивания отчета
        const reportUrl = `/api/report/tank?type=${tankType}&id=${tankId}&startDate=${startDate}&endDate=${endDate}`;
        
        // Открытие URL в новом окне для скачивания
        window.open(reportUrl, '_blank');
    });
    
    // Обработчики для формы общего отчета
    $('#period-report-form').on('submit', function(e) {
        e.preventDefault();
        
        const startDate = $('#period-report-start-date').val();
        const endDate = $('#period-report-end-date').val();
        
        // Формирование URL для скачивания отчета
        const reportUrl = `/api/report/period?startDate=${startDate}&endDate=${endDate}`;
        
        // Открытие URL в новом окне для скачивания
        window.open(reportUrl, '_blank');
    });
    
    // Обработчик изменения типа танка
    $('#tank-type').on('change', function() {
        updateTankOptions();
    });
    
    // Инициализация выбора танков
    loadTankOptions();
});

// Обновление данных о танках из текущих данных
function updateTanksData(currentData) {
    if (!currentData) return;
    
    // Обновление данных о входных танках
    tanksData.input = currentData.inputTanks || {};
    
    // Обновление данных о выходных танках
    tanksData.output = currentData.outputTanks || {};
    
    // Обновление данных о платформе
    tanksData.platform = {
        weight: currentData.weight || 0,
        dispatch: currentData.dispatch || 0
    };
    
    // Обновление активных танков
    tanksData.activeTanks = currentData.activeTanks || { input: null, output: null };
    
    // Обновление интерфейса, если активна страница танков
    if ($('#tanks-page').hasClass('active')) {
        updateTanksInterface();
    }
}

// Обновление интерфейса танков
function updateTanksInterface() {
    // Очистка контейнеров
    $('#input-tanks-container').empty();
    $('#output-tanks-container').empty();
    
    // Обновление входных танков
    for (const tankKey in tanksData.input) {
        const tank = tanksData.input[tankKey];
        const isActive = tankKey === tanksData.activeTanks.input;
        
        const tankHtml = `
            <div class="tank-card input-tank">
                <div class="tank-header">
                    <span>${tank.name}</span>
                    <span>${tankKey.replace('tank', 'Танк ')}</span>
                </div>
                <div class="tank-body">
                    <div class="tank-weight">${Math.round(tank.currentWeight)} кг</div>
                    <div class="tank-status-container">
                        <span class="tank-status ${tank.dumping === 1 ? 'active' : 'inactive'}">
                            ${tank.dumping === 1 ? 'Активен' : 'Неактивен'}
                        </span>
                    </div>
                </div>
            </div>
        `;
        
        $('#input-tanks-container').append(tankHtml);
    }
    
    // Обновление выходных танков
    for (const tankKey in tanksData.output) {
        const tank = tanksData.output[tankKey];
        const isActive = tankKey === tanksData.activeTanks.output;
        
        const tankHtml = `
            <div class="tank-card output-tank">
                <div class="tank-header">
                    <span>${tank.name}</span>
                    <span>${tankKey.replace('tank', 'Танк ')}</span>
                </div>
                <div class="tank-body">
                    <div class="tank-weight">${Math.round(tank.currentWeight)} кг</div>
                    <div class="tank-status-container">
                        <span class="tank-status ${tank.active === 1 ? 'active' : 'inactive'}">
                            ${tank.active === 1 ? 'Активен' : 'Неактивен'}
                        </span>
                    </div>
                </div>
            </div>
        `;
        
        $('#output-tanks-container').append(tankHtml);
    }
    
    // Обновление весовой платформы
    $('#platform-weight').text(tanksData.platform.weight);
    
    const dispatchStatus = $('#platform-status');
    dispatchStatus.removeClass('dispatch-on dispatch-off');
    
    if (tanksData.platform.dispatch === 1) {
        dispatchStatus.text('Отгрузка активна');
        dispatchStatus.addClass('dispatch-on');
    } else {
        dispatchStatus.text('Ожидание');
        dispatchStatus.addClass('dispatch-off');
    }
    
    // Обновление диаграммы перемещений
    updateTransferDiagram();
}

// Обновление диаграммы перемещений
function updateTransferDiagram() {
    // Обновление входных танков на диаграмме
    $('#diagram-input-tanks').empty();
    
    for (const tankKey in tanksData.input) {
        const tank = tanksData.input[tankKey];
        const isActive = tankKey === tanksData.activeTanks.input;
        
        const tankHtml = `
            <div class="diagram-tank input-tank ${isActive ? 'active' : ''}">
                <div class="diagram-tank-name">${tank.name}</div>
                <div class="diagram-tank-weight">${Math.round(tank.currentWeight)} кг</div>
            </div>
        `;
        
        $('#diagram-input-tanks').append(tankHtml);
    }
    
    // Обновление выходных танков на диаграмме
    $('#diagram-output-tanks').empty();
    
    for (const tankKey in tanksData.output) {
        const tank = tanksData.output[tankKey];
        const isActive = tankKey === tanksData.activeTanks.output;
        
        const tankHtml = `
            <div class="diagram-tank output-tank ${isActive ? 'active' : ''}">
                <div class="diagram-tank-name">${tank.name}</div>
                <div class="diagram-tank-weight">${Math.round(tank.currentWeight)} кг</div>
            </div>
        `;
        
        $('#diagram-output-tanks').append(tankHtml);
    }
    
    // Обновление весовой платформы на диаграмме
    $('#diagram-platform-weight').text(tanksData.platform.weight + ' кг');
    
    // Обновление стрелок
    const inputArrow = $('#diagram-input-arrow');
    const outputArrow = $('#diagram-output-arrow');
    
    inputArrow.removeClass('active inactive');
    outputArrow.removeClass('active inactive');
    
    if (tanksData.activeTanks.input) {
        inputArrow.addClass('active');
    } else {
        inputArrow.addClass('inactive');
    }
    
    if (tanksData.activeTanks.output) {
        outputArrow.addClass('active');
    } else {
        outputArrow.addClass('inactive');
    }
}

// Загрузка операций перемещения
function loadTransferOperations(date) {
    fetch(`/api/archives/transfers?date=${date}`)
        .then(response => response.json())
        .then(data => {
            const tableBody = $('#transfers-list');
            tableBody.empty();
            
            if (data.length === 0) {
                tableBody.append('<tr><td colspan="6" class="text-center">Нет данных о перемещениях за выбранную дату</td></tr>');
                return;
            }
            
            // Сортировка данных по времени (от позднего к раннему)
            data.sort((a, b) => {
                return new Date(b.timestamp) - new Date(a.timestamp);
            });
            
            // Добавление строк в таблицу
            data.forEach((operation, index) => {
                const time = moment(operation.timestamp).format('HH:mm:ss');
                const fromTank = operation.fromTank.name;
                const toTank = operation.toTank.name;
                const weight = operation.weight;
                
                const row = `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${time}</td>
                        <td>${fromTank}</td>
                        <td>${toTank}</td>
                        <td>${weight} кг</td>
                    </tr>
                `;
                
                tableBody.append(row);
            });
        })
        .catch(error => {
            console.error('Ошибка загрузки операций перемещения:', error);
            $('#transfers-list').html('<tr><td colspan="6" class="text-center text-danger">Ошибка загрузки данных</td></tr>');
        });
}

// Загрузка опций танков для отчетов
function loadTankOptions() {
    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            // Сохранение конфигурации танков
            window.tanksConfig = config.tanks;
            
            // Обновление списка танков
            updateTankOptions();
        })
        .catch(error => {
            console.error('Ошибка загрузки конфигурации танков:', error);
        });
}

// Обновление списка танков в зависимости от выбранного типа
function updateTankOptions() {
    if (!window.tanksConfig) return;
    
    const tankType = $('#tank-type').val();
    const tankSelect = $('#tank-id');
    
    // Очистка списка
    tankSelect.empty();
    
    // Добавление опций в зависимости от типа
    const tanks = tankType === 'input' ? window.tanksConfig.input : window.tanksConfig.output;
    
    tanks.forEach(tank => {
        tankSelect.append(`<option value="${tank.id}">${tank.name}</option>`);
    });
}
