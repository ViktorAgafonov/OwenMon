// Сервис для работы с архивами данных
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

// Пути к директориям архивов
const ARCHIVE_DIR = path.join(__dirname, '../archives');
const HOURLY_ARCHIVE_DIR = path.join(ARCHIVE_DIR, 'hourly');
const SHIFT_ARCHIVE_DIR = path.join(ARCHIVE_DIR, 'shifts');
const TRANSFER_ARCHIVE_DIR = path.join(ARCHIVE_DIR, 'transfers');
const TANKS_STATE_DIR = path.join(ARCHIVE_DIR, 'tanks-state');
const WEIGHTS_CORRECTION_DIR = path.join(ARCHIVE_DIR, 'weights-correction');

// Инициализация сервиса
async function init() {
  try {
    // Создание директорий для архивов, если они не существуют
    await fs.ensureDir(ARCHIVE_DIR);
    await fs.ensureDir(HOURLY_ARCHIVE_DIR);
    await fs.ensureDir(SHIFT_ARCHIVE_DIR);
    await fs.ensureDir(TRANSFER_ARCHIVE_DIR);
    await fs.ensureDir(TANKS_STATE_DIR);
    await fs.ensureDir(WEIGHTS_CORRECTION_DIR);
    
    // Запуск процесса формирования архивов смен
    scheduleShiftArchiving();
    
    // Запуск процесса сохранения состояния танков
    scheduleTanksStateArchiving();
    
    return true;
  } catch (error) {
    console.error('Ошибка инициализации сервиса архивов:', error);
    return false;
  }
}

// Сохранение часовых данных
async function saveHourlyData(data) {
  try {
    if (!data || data.length === 0) {
      return false;
    }
    
    // Формирование имени файла в формате YYYY-MM-DD_HH.json
    const timestamp = moment(data[0].timestamp);
    const fileName = `${timestamp.format('YYYY-MM-DD_HH')}.json`;
    const filePath = path.join(HOURLY_ARCHIVE_DIR, fileName);
    
    // Расчет статистики веса (используем int16 вес)
    const weights = data.map(item => item.weightInt16 || item.weight);
    const stats = {
      min: Math.min(...weights),
      max: Math.max(...weights),
      avg: weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
      sum: weights.reduce((sum, weight) => sum + weight, 0)
    };
    
    // Сохранение данных в файл
    await fs.writeJson(filePath, {
      startTime: timestamp.toISOString(),
      endTime: moment(data[data.length - 1].timestamp).toISOString(),
      count: data.length,
      stats,
      data
    }, { spaces: 2 });
    
    console.log(`Сохранен часовой архив: ${fileName}`);
    return true;
  } catch (error) {
    console.error('Ошибка сохранения часового архива:', error);
    return false;
  }
}

// Сохранение операции перемещения продукта
async function saveTransferOperation(operation) {
  try {
    if (!operation) {
      return false;
    }
    
    // Формирование имени файла в формате YYYY-MM-DD.json
    const timestamp = moment(operation.timestamp);
    const fileName = `${timestamp.format('YYYY-MM-DD')}.json`;
    const filePath = path.join(TRANSFER_ARCHIVE_DIR, fileName);
    
    // Проверка существования файла
    let operations = [];
    if (await fs.pathExists(filePath)) {
      operations = await fs.readJson(filePath);
    }
    
    // Добавление новой операции
    operations.push(operation);
    
    // Сохранение данных в файл
    await fs.writeJson(filePath, operations, { spaces: 2 });
    
    console.log(`Сохранена операция перемещения: ${operation.weight} кг из ${operation.fromTank.name} в ${operation.toTank.name}`);
    return true;
  } catch (error) {
    console.error('Ошибка сохранения операции перемещения:', error);
    return false;
  }
}

// Сохранение массива операций перемещения
async function saveTransferOperations(operations) {
  try {
    if (!operations || operations.length === 0) {
      return false;
    }
    
    // Группировка операций по дате
    const operationsByDate = {};
    
    operations.forEach(operation => {
      const date = moment(operation.timestamp).format('YYYY-MM-DD');
      if (!operationsByDate[date]) {
        operationsByDate[date] = [];
      }
      operationsByDate[date].push(operation);
    });
    
    // Сохранение операций для каждой даты
    for (const date in operationsByDate) {
      const fileName = `${date}.json`;
      const filePath = path.join(TRANSFER_ARCHIVE_DIR, fileName);
      
      // Проверка существования файла
      let existingOperations = [];
      if (await fs.pathExists(filePath)) {
        existingOperations = await fs.readJson(filePath);
      }
      
      // Добавление новых операций
      const updatedOperations = [...existingOperations, ...operationsByDate[date]];
      
      // Сохранение данных в файл
      await fs.writeJson(filePath, updatedOperations, { spaces: 2 });
      
      console.log(`Сохранено ${operationsByDate[date].length} операций перемещения за ${date}`);
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка сохранения операций перемещения:', error);
    return false;
  }
}

// Сохранение состояния танков
async function saveTanksState(tanksState) {
  try {
    if (!tanksState) {
      return false;
    }
    
    // Формирование имени файла в формате YYYY-MM-DD_HH-mm.json
    const timestamp = moment();
    const fileName = `${timestamp.format('YYYY-MM-DD_HH-mm')}.json`;
    const filePath = path.join(TANKS_STATE_DIR, fileName);
    
    // Сохранение данных в файл
    await fs.writeJson(filePath, {
      timestamp: timestamp.toISOString(),
      tanks: tanksState
    }, { spaces: 2 });
    
    console.log(`Сохранено состояние танков: ${fileName}`);
    return true;
  } catch (error) {
    console.error('Ошибка сохранения состояния танков:', error);
    return false;
  }
}

// Получение часовых архивов за указанную дату
async function getHourlyArchives(date) {
  try {
    console.log(`Запрос часовых архивов за дату: ${date}`);
    const datePrefix = moment(date).format('YYYY-MM-DD');
    
    // Проверка существования директории
    await fs.ensureDir(HOURLY_ARCHIVE_DIR);
    
    const files = await fs.readdir(HOURLY_ARCHIVE_DIR);
    console.log(`Найдено файлов в директории часовых архивов: ${files.length}`);
    
    // Фильтрация файлов по дате
    const matchingFiles = files.filter(file => file.startsWith(datePrefix));
    console.log(`Файлы, соответствующие дате ${datePrefix}: ${matchingFiles.length}`);
    
    // Если файлов нет, попробуем проверить наличие операций перемещения
    if (matchingFiles.length === 0) {
      console.log(`Не найдено часовых архивов за дату ${datePrefix}, проверяем операции перемещения`);
      
      // Проверяем, есть ли операции перемещения за этот день
      const transferFileName = `${datePrefix}.json`;
      const transferFilePath = path.join(TRANSFER_ARCHIVE_DIR, transferFileName);
      
      if (await fs.pathExists(transferFilePath)) {
        console.log(`Найден файл операций перемещения: ${transferFileName}`);
        
        // Создаем фиктивный часовой архив на основе операций перемещения
        const transferOps = await fs.readJson(transferFilePath);
        
        if (transferOps && transferOps.length > 0) {
          console.log(`Найдено ${transferOps.length} операций перемещения`);
          
          // Группируем операции по часу
          const operationsByHour = {};
          
          transferOps.forEach(op => {
            const opTime = moment(op.timestamp);
            const hour = opTime.hour();
            
            if (!operationsByHour[hour]) {
              operationsByHour[hour] = [];
            }
            
            operationsByHour[hour].push(op);
          });
          
          // Создаем архивы по часам
          const archives = [];
          
          for (const hour in operationsByHour) {
            const operations = operationsByHour[hour];
            
            // Рассчитываем статистику
            const weights = operations.map(op => op.weight);
            const stats = {
              min: Math.min(...weights),
              max: Math.max(...weights),
              avg: weights.reduce((sum, w) => sum + w, 0) / weights.length,
              sum: weights.reduce((sum, w) => sum + w, 0)
            };
            
            // Создаем архив
            archives.push({
              hour: hour,
              startTime: moment(date).hour(hour).startOf('hour').toISOString(),
              endTime: moment(date).hour(hour).endOf('hour').toISOString(),
              count: operations.length,
              stats,
              data: operations
            });
          }
          
          // Сохраняем созданные архивы для будущего использования
          for (const archive of archives) {
            const fileName = `${datePrefix}_${archive.hour.padStart(2, '0')}.json`;
            const filePath = path.join(HOURLY_ARCHIVE_DIR, fileName);
            
            if (!await fs.pathExists(filePath)) {
              await fs.writeJson(filePath, {
                startTime: archive.startTime,
                endTime: archive.endTime,
                count: archive.count,
                stats: archive.stats,
                data: archive.data
              }, { spaces: 2 });
              
              console.log(`Создан часовой архив на основе операций перемещения: ${fileName}`);
            }
          }
          
          return archives.sort((a, b) => a.hour - b.hour);
        }
      }
      
      console.log(`Не найдено операций перемещения за дату ${datePrefix}`);
      return [];
    }
    
    // Чтение содержимого файлов
    const archives = await Promise.all(
      matchingFiles.map(async file => {
        const filePath = path.join(HOURLY_ARCHIVE_DIR, file);
        try {
          const data = await fs.readJson(filePath);
          return {
            hour: file.split('_')[1].split('.')[0],
            ...data
          };
        } catch (err) {
          console.error(`Ошибка чтения файла ${file}:`, err);
          return null;
        }
      })
    );
    
    // Удаляем null значения (если были ошибки при чтении)
    const validArchives = archives.filter(archive => archive !== null);
    
    console.log(`Успешно загружено архивов: ${validArchives.length}`);
    
    // Сортировка по времени
    return validArchives.sort((a, b) => {
      const hourA = parseInt(a.hour);
      const hourB = parseInt(b.hour);
      return hourA - hourB;
    });
  } catch (error) {
    console.error('Ошибка получения часовых архивов:', error);
    return [];
  }
}

// Получение архивов смен за указанную дату
async function getShiftArchives(date) {
  try {
    console.log(`Запрос архивов смен за дату: ${date}`);
    const datePrefix = moment(date).format('YYYY-MM-DD');
    
    // Проверка существования директории
    await fs.ensureDir(SHIFT_ARCHIVE_DIR);
    
    const files = await fs.readdir(SHIFT_ARCHIVE_DIR);
    console.log(`Найдено файлов в директории архивов смен: ${files.length}`);
    
    // Фильтрация файлов по дате
    const matchingFiles = files.filter(file => file.startsWith(datePrefix));
    console.log(`Файлы, соответствующие дате ${datePrefix}: ${matchingFiles.length}`);
    
    // Если нет архивов смен, но есть часовые архивы, создаем архивы смен
    if (matchingFiles.length === 0) {
      console.log(`Не найдено архивов смен за дату ${datePrefix}, проверяем наличие часовых архивов`);
      
      // Получаем часовые архивы
      const hourlyArchives = await getHourlyArchives(date);
      
      if (hourlyArchives && hourlyArchives.length > 0) {
        console.log(`Найдено ${hourlyArchives.length} часовых архивов, создаем архивы смен`);
        
        // Получаем конфигурацию смен
        const configPath = path.join(__dirname, '../config/config.json');
        let config;
        
        try {
          config = await fs.readJson(configPath);
        } catch (err) {
          console.error('Ошибка чтения конфигурации:', err);
          return [];
        }
        
        if (!config.shifts || !Array.isArray(config.shifts)) {
          console.error('Конфигурация смен не найдена или имеет неверный формат');
          return [];
        }
        
        // Создаем архивы для каждой смены
        const shiftArchives = [];
        
        for (let i = 0; i < config.shifts.length; i++) {
          const shiftNumber = i + 1;
          try {
            // Создаем архив смены
            await createShiftArchive(date, shiftNumber);
            console.log(`Создан архив для смены ${shiftNumber}`);
          } catch (err) {
            console.error(`Ошибка создания архива для смены ${shiftNumber}:`, err);
          }
        }
        
        // Повторно ищем файлы архивов после создания
        const updatedFiles = await fs.readdir(SHIFT_ARCHIVE_DIR);
        const updatedMatchingFiles = updatedFiles.filter(file => file.startsWith(datePrefix));
        
        if (updatedMatchingFiles.length > 0) {
          console.log(`После создания архивов найдено ${updatedMatchingFiles.length} файлов`);
          
          // Читаем созданные архивы
          const archives = await Promise.all(
            updatedMatchingFiles.map(async file => {
              const filePath = path.join(SHIFT_ARCHIVE_DIR, file);
              try {
                const data = await fs.readJson(filePath);
                return {
                  shift: file.split('_')[1].split('.')[0],
                  ...data
                };
              } catch (err) {
                console.error(`Ошибка чтения файла ${file}:`, err);
                return null;
              }
            })
          );
          
          // Удаляем null значения
          const validArchives = archives.filter(archive => archive !== null);
          
          console.log(`Успешно загружено архивов смен: ${validArchives.length}`);
          
          // Сортировка по номеру смены
          return validArchives.sort((a, b) => parseInt(a.shift) - parseInt(b.shift));
        }
      }
      
      console.log(`Не найдено часовых архивов за дату ${datePrefix}`);
      return [];
    }
    
    // Чтение содержимого файлов
    const archives = await Promise.all(
      matchingFiles.map(async file => {
        const filePath = path.join(SHIFT_ARCHIVE_DIR, file);
        try {
          const data = await fs.readJson(filePath);
          return {
            shift: file.split('_')[1].split('.')[0],
            ...data
          };
        } catch (err) {
          console.error(`Ошибка чтения файла ${file}:`, err);
          return null;
        }
      })
    );
    
    // Удаляем null значения
    const validArchives = archives.filter(archive => archive !== null);
    
    console.log(`Успешно загружено архивов смен: ${validArchives.length}`);
    
    // Сортировка по номеру смены
    return validArchives.sort((a, b) => parseInt(a.shift) - parseInt(b.shift));
  } catch (error) {
    console.error('Ошибка получения архивов смен:', error);
    return [];
  }
}

// Получение операций перемещения за указанную дату
async function getTransferOperations(date) {
  try {
    console.log(`Запрос операций перемещения за дату: ${date}`);
    const dateStr = moment(date).format('YYYY-MM-DD');
    const fileName = `${dateStr}.json`;
    const filePath = path.join(TRANSFER_ARCHIVE_DIR, fileName);
    
    // Проверка существования директории
    await fs.ensureDir(TRANSFER_ARCHIVE_DIR);
    
    if (await fs.pathExists(filePath)) {
      console.log(`Найден файл операций перемещения: ${fileName}`);
      const operations = await fs.readJson(filePath);
      console.log(`Загружено ${operations.length} операций перемещения`);
      return operations;
    }
    
    console.log(`Файл операций перемещения не найден: ${fileName}`);
    return [];
  } catch (error) {
    console.error('Ошибка получения операций перемещения:', error);
    return [];
  }
}

// Получение последнего состояния танков
async function getLatestTanksState() {
  try {
    const files = await fs.readdir(TANKS_STATE_DIR);
    
    if (files.length === 0) {
      return null;
    }
    
    // Сортировка файлов по времени создания (от новых к старым)
    files.sort((a, b) => {
      const timeA = moment(a.split('.')[0], 'YYYY-MM-DD_HH-mm');
      const timeB = moment(b.split('.')[0], 'YYYY-MM-DD_HH-mm');
      return timeB.diff(timeA);
    });
    
    // Чтение последнего файла
    const latestFile = files[0];
    const filePath = path.join(TANKS_STATE_DIR, latestFile);
    
    return await fs.readJson(filePath);
  } catch (error) {
    console.error('Ошибка получения последнего состояния танков:', error);
    return null;
  }
}

// Формирование архива смены
async function createShiftArchive(date, shiftNumber) {
  try {
    // Получение конфигурации из файла
    const configPath = path.join(__dirname, '../config/config.json');
    const config = await fs.readJson(configPath);
    
    // Определение временных границ смены
    const shiftConfig = config.shifts[shiftNumber - 1];
    
    if (!shiftConfig) {
      throw new Error(`Смена ${shiftNumber} не найдена в конфигурации`);
    }
    
    const dateObj = moment(date);
    let startTime, endTime;
    
    // Если смена переходит на следующий день
    if (shiftConfig.startHour > shiftConfig.endHour) {
      startTime = dateObj.clone().hour(shiftConfig.startHour).minute(0).second(0);
      endTime = dateObj.clone().add(1, 'day').hour(shiftConfig.endHour).minute(0).second(0);
    } else {
      startTime = dateObj.clone().hour(shiftConfig.startHour).minute(0).second(0);
      endTime = dateObj.clone().hour(shiftConfig.endHour).minute(0).second(0);
    }
    
    // Получение часовых архивов за период смены
    const hourlyData = await getHourlyDataForTimeRange(startTime, endTime);
    
    // Получение операций перемещения за период смены
    const transferOps = await getTransferOperationsForTimeRange(startTime, endTime);
    
    if (hourlyData.length === 0 && transferOps.length === 0) {
      throw new Error('Нет данных для формирования архива смены');
    }
    
    // Расчет статистики по весам
    const allMeasurements = hourlyData.flatMap(hour => hour.data);
    const weights = allMeasurements.map(item => item.weight);
    
    const stats = weights.length > 0 ? {
      min: Math.min(...weights),
      max: Math.max(...weights),
      avg: weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
      sum: weights.reduce((sum, weight) => sum + weight, 0)
    } : {
      min: 0,
      max: 0,
      avg: 0,
      sum: 0
    };
    
    // Расчет статистики по перемещениям
    const transferStats = {
      totalOperations: transferOps.length,
      totalWeight: transferOps.reduce((sum, op) => sum + op.weight, 0),
      byInputTank: {},
      byOutputTank: {}
    };
    
    // Расчет статистики по входным танкам
    transferOps.forEach(op => {
      const fromTankId = op.fromTank.id;
      const toTankId = op.toTank.id;
      
      // Статистика по входным танкам
      if (!transferStats.byInputTank[fromTankId]) {
        transferStats.byInputTank[fromTankId] = {
          name: op.fromTank.name,
          totalWeight: 0,
          operations: 0
        };
      }
      
      transferStats.byInputTank[fromTankId].totalWeight += op.weight;
      transferStats.byInputTank[fromTankId].operations += 1;
      
      // Статистика по выходным танкам
      if (!transferStats.byOutputTank[toTankId]) {
        transferStats.byOutputTank[toTankId] = {
          name: op.toTank.name,
          totalWeight: 0,
          operations: 0
        };
      }
      
      transferStats.byOutputTank[toTankId].totalWeight += op.weight;
      transferStats.byOutputTank[toTankId].operations += 1;
    });
    
    // Формирование имени файла в формате YYYY-MM-DD_SHIFT.json
    const fileName = `${dateObj.format('YYYY-MM-DD')}_${shiftNumber}.json`;
    const filePath = path.join(SHIFT_ARCHIVE_DIR, fileName);
    
    // Сохранение данных в файл
    await fs.writeJson(filePath, {
      date: dateObj.format('YYYY-MM-DD'),
      shift: shiftNumber,
      shiftName: shiftConfig.name,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stats,
      transferStats,
      hourlyData,
      transferOperations: transferOps
    }, { spaces: 2 });
    
    console.log(`Сохранен архив смены: ${fileName}`);
    return filePath;
  } catch (error) {
    console.error('Ошибка формирования архива смены:', error);
    throw error;
  }
}

// Получение часовых данных за указанный временной диапазон
async function getHourlyDataForTimeRange(startTime, endTime) {
  try {
    const result = [];
    let currentHour = startTime.clone().startOf('hour');
    
    while (currentHour.isBefore(endTime)) {
      const fileName = `${currentHour.format('YYYY-MM-DD_HH')}.json`;
      const filePath = path.join(HOURLY_ARCHIVE_DIR, fileName);
      
      if (await fs.pathExists(filePath)) {
        const hourData = await fs.readJson(filePath);
        result.push(hourData);
      }
      
      currentHour.add(1, 'hour');
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка получения часовых данных за диапазон:', error);
    return [];
  }
}

// Получение операций перемещения за указанный временной диапазон
async function getTransferOperationsForTimeRange(startTime, endTime) {
  try {
    const result = [];
    
    // Получение всех дат в диапазоне
    const dates = [];
    let currentDate = startTime.clone().startOf('day');
    
    while (currentDate.isBefore(endTime)) {
      dates.push(currentDate.format('YYYY-MM-DD'));
      currentDate.add(1, 'day');
    }
    
    // Получение операций для каждой даты
    for (const date of dates) {
      const operations = await getTransferOperations(date);
      
      // Фильтрация операций по времени
      const filteredOperations = operations.filter(op => {
        const opTime = moment(op.timestamp);
        return opTime.isAfter(startTime) && opTime.isBefore(endTime);
      });
      
      result.push(...filteredOperations);
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка получения операций перемещения за диапазон:', error);
    return [];
  }
}

// Планирование формирования архивов смен
async function scheduleShiftArchiving() {
  try {
    // Загрузка конфигурации
    const configPath = path.join(__dirname, '../config/config.json');
    const config = await fs.readJson(configPath);
    
    // Для каждой смены планируем создание архива по окончании смены
    config.shifts.forEach((shift, index) => {
      const shiftNumber = index + 1;
      const endHour = shift.endHour;
      
      // Запуск ежедневно в час окончания смены
      scheduleDaily(endHour, 5, async () => {
        const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
        const today = moment().format('YYYY-MM-DD');
        
        // Если смена переходит на следующий день, архив создаем для предыдущего дня
        if (shift.startHour > shift.endHour) {
          await createShiftArchive(yesterday, shiftNumber);
        } else {
          await createShiftArchive(today, shiftNumber);
        }
      });
    });
  } catch (error) {
    console.error('Ошибка планирования архивирования смен:', error);
  }
}

// Планирование сохранения состояния танков
function scheduleTanksStateArchiving() {
  // Сохранение состояния танков каждый час
  setInterval(async () => {
    try {
      // Получение текущего состояния танков из модуля Modbus
      const modbusService = require('./modbusService');
      const currentData = modbusService.getCurrentData();
      
      // Формирование состояния танков
      const tanksState = {
        input: currentData.inputTanks,
        output: currentData.outputTanks
      };
      
      // Сохранение состояния
      await saveTanksState(tanksState);
    } catch (error) {
      console.error('Ошибка сохранения состояния танков:', error);
    }
  }, 60 * 60 * 1000); // Каждый час
}

// Планирование ежедневного выполнения задачи
function scheduleDaily(hour, minute, task) {
  const now = moment();
  let scheduledTime = moment().hour(hour).minute(minute).second(0);
  
  // Если указанное время уже прошло, планируем на следующий день
  if (now.isAfter(scheduledTime)) {
    scheduledTime.add(1, 'day');
  }
  
  // Расчет задержки до выполнения
  const delay = scheduledTime.diff(now);
  
  // Планирование первого выполнения
  setTimeout(() => {
    task();
    
    // Планирование последующих выполнений каждые 24 часа
    setInterval(task, 24 * 60 * 60 * 1000);
  }, delay);
}

// Сохранение корректировки веса силосов
async function saveWeightCorrection(correction) {
  try {
    if (!correction) {
      return false;
    }
    
    // Формирование имени файла в формате YYYY-MM-DD_HH-mm-ss.json
    const timestamp = moment(correction.correction.timestamp);
    const fileName = `${timestamp.format('YYYY-MM-DD_HH-mm-ss')}.json`;
    const filePath = path.join(WEIGHTS_CORRECTION_DIR, fileName);
    
    // Сохранение данных в файл
    await fs.writeJson(filePath, correction, { spaces: 2 });
    
    console.log(`Сохранена корректировка весов: ${fileName}`);
    
    // Также сохраним текущее состояние танков после корректировки
    const tanksState = {
      input: {},
      output: {}
    };
    
    // Заполнение данных о входных танках
    correction.tanks.input.forEach(tank => {
      tanksState.input[`tank${tank.id}`] = {
        name: tank.name,
        currentWeight: tank.initialWeight
      };
    });
    
    // Заполнение данных о выходных танках
    correction.tanks.output.forEach(tank => {
      tanksState.output[`tank${tank.id}`] = {
        name: tank.name,
        currentWeight: tank.initialWeight
      };
    });
    
    // Сохранение состояния танков
    await saveTanksState({
      source: 'correction',
      reason: correction.correction.reason,
      tanks: tanksState
    });
    
    return true;
  } catch (error) {
    console.error('Ошибка сохранения корректировки веса:', error);
    return false;
  }
}

// Получение истории корректировок веса
async function getWeightCorrections(startDate, endDate) {
  try {
    const files = await fs.readdir(WEIGHTS_CORRECTION_DIR);
    
    if (files.length === 0) {
      return [];
    }
    
    // Фильтрация файлов по диапазону дат, если указаны
    let filteredFiles = files;
    
    if (startDate && endDate) {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      filteredFiles = files.filter(file => {
        const fileDate = moment(file.split('.')[0], 'YYYY-MM-DD_HH-mm-ss');
        return fileDate.isBetween(start, end, null, '[]');
      });
    }
    
    // Чтение всех файлов корректировок
    const corrections = await Promise.all(
      filteredFiles.map(async file => {
        const filePath = path.join(WEIGHTS_CORRECTION_DIR, file);
        return await fs.readJson(filePath);
      })
    );
    
    // Сортировка по времени (от новых к старым)
    return corrections.sort((a, b) => {
      return moment(b.correction.timestamp).diff(moment(a.correction.timestamp));
    });
  } catch (error) {
    console.error('Ошибка получения истории корректировок:', error);
    return [];
  }
}

// Экспорт функций модуля
module.exports = {
  init,
  saveHourlyData,
  saveTransferOperation,
  saveTransferOperations,
  saveTanksState,
  saveWeightCorrection,
  getHourlyArchives,
  getShiftArchives,
  getTransferOperations,
  getLatestTanksState,
  getWeightCorrections,
  createShiftArchive,
  getHourlyDataForTimeRange,
  getTransferOperationsForTimeRange,
  scheduleShiftArchiving,
  scheduleTanksStateArchiving
};
