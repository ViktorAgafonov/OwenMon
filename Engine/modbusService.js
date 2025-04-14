// Сервис для работы с Modbus-устройством весов
// Обеспечивает взаимодействие с устройством по протоколу Modbus TCP
// и обработку данных о весе в формате int16
const ModbusRTU = require('modbus-serial');
const fs = require('fs-extra');
const path = require('path');
const archiveService = require('./archiveService');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

// Клиент Modbus
const client = new ModbusRTU();

// Текущие данные с весов
let currentData = {
  weight: 0,
  weightInt16: 0, // Вес в формате int16
  timestamp: new Date(),
  status: 'disconnected',
  dispatch: 0,
  inputTanks: {
    tank1: { dumping: 0, name: 'Силос муки 1', currentWeight: 1000 },
    tank2: { dumping: 0, name: 'Силос муки 2', currentWeight: 1000 },
    tank3: { dumping: 0, name: 'Силос муки 3', currentWeight: 1000 }
  },
  outputTanks: {
    tank1: { active: 0, name: 'Промежуточный 1', currentWeight: 0 },
    tank2: { active: 0, name: 'Промежуточный 2', currentWeight: 0 },
    tank3: { active: 0, name: 'Промежуточный 3', currentWeight: 0 }
  },
  activeTanks: {
    input: null,
    output: null
  },
  error: null,
  transferOperation: null
};

// Массив для хранения данных за текущий час
let hourlyData = [];

// Массив для хранения операций перемещения
let transferOperations = [];

// Последнее значение веса перед операцией dispatch
let lastWeightBeforeDispatch = 0;

// Настройки подключения по умолчанию
let config = {
  modbus: {
    connectionType: 'tcp',
    host: '192.168.1.100',
    port: 502,
    slaveId: 1,
    pollInterval: 1000,
    // Адреса регистров Modbus устройства:
    // Все адреса указываются в формате адресов Modbus (0-based),
    // и могут быть настроены через веб-интерфейс в разделе "Настройки"
    registers: {
      weight: 0,     // Регистр веса (считывается как int16)
      dispatch: 1,   // Регистр сигнала dispatch (1 = активен, 0 = неактивен)
      // Регистры для входных танков (1 = активен, 0 = неактивен)
      dumpInputTank_1: 2,
      dumpInputTank_2: 3,
      dumpInputTank_3: 4,
      // Регистры для выходных танков (1 = активен, 0 = неактивен)
      outTank_1: 5,
      outTank_2: 6,
      outTank_3: 7
    }
  },
  tanks: {
    input: [
      {
        id: 1,
        name: 'Силос муки 1',
        registerName: 'dumpInputTank_1',
        initialWeight: 1000
      },
      {
        id: 2,
        name: 'Силос муки 2',
        registerName: 'dumpInputTank_2',
        initialWeight: 1000
      },
      {
        id: 3,
        name: 'Силос муки 3',
        registerName: 'dumpInputTank_3',
        initialWeight: 1000
      }
    ],
    output: [
      {
        id: 1,
        name: 'Промежуточный 1',
        registerName: 'outTank_1',
        initialWeight: 0
      },
      {
        id: 2,
        name: 'Промежуточный 2',
        registerName: 'outTank_2',
        initialWeight: 0
      },
      {
        id: 3,
        name: 'Промежуточный 3',
        registerName: 'outTank_3',
        initialWeight: 0
      }
    ]
  }
};

// Функция для преобразования значения из регистра в int16
function convertToInt16(value) {
  // Если число больше 32767, преобразуем его в отрицательное int16
  if (value > 32767) {
    return value - 65536;
  }
  return value;
}

// Инициализация сервиса
async function init(io) {
  try {
    // Загрузка настроек
    await loadConfig();
    
    // Инициализация данных танков из конфигурации
    initTanksData();
    
    // Подключение к устройству
    await connectToDevice();
    
    // Запуск опроса устройства
    startPolling(io);
    
    return true;
  } catch (error) {
    console.error('Ошибка инициализации Modbus-сервиса:', error);
    return false;
  }
}

// Инициализация данных танков из конфигурации
function initTanksData() {
  // Инициализация входных танков
  config.tanks.input.forEach(tank => {
    const tankKey = `tank${tank.id}`;
    currentData.inputTanks[tankKey] = {
      dumping: 0,
      name: tank.name,
      currentWeight: tank.initialWeight || 1000
    };
  });

  // Инициализация выходных танков
  config.tanks.output.forEach(tank => {
    const tankKey = `tank${tank.id}`;
    currentData.outputTanks[tankKey] = {
      active: 0,
      name: tank.name,
      currentWeight: tank.initialWeight || 0
    };
  });
}

// Загрузка настроек из файла
async function loadConfig() {
  try {
    const configPath = path.join(__dirname, '../config/config.json');
    
    if (await fs.pathExists(configPath)) {
      config = await fs.readJson(configPath);
      console.log('Конфигурация загружена успешно');
    } else {
      // Создание файла настроек по умолчанию, если он не существует
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, config, { spaces: 2 });
      console.log('Создан файл конфигурации по умолчанию');
    }
  } catch (error) {
    console.error('Ошибка загрузки конфигурации:', error);
  }
}

// Сохранение конфигурации
async function saveConfig(newConfig) {
  try {
    const configPath = path.join(__dirname, '../config/config.json');
    
    // Обновление глобальной конфигурации
    config = newConfig;
    
    // Сохранение в файл
    await fs.writeJson(configPath, config, { spaces: 2 });
    
    // Обновление данных танков
    initTanksData();
    
    console.log('Конфигурация сохранена успешно');
    return true;
  } catch (error) {
    console.error('Ошибка сохранения конфигурации:', error);
    return false;
  }
}

// Подключение к устройству Modbus
async function connectToDevice() {
  try {
    // Закрытие предыдущего соединения, если оно существует
    if (client.isOpen) {
      await client.close();
    }
    
    // Подключение через Modbus TCP
      await client.connectTCP(config.modbus.host, { port: config.modbus.port });
    
    // Установка ID устройства
    client.setID(config.modbus.slaveId);
    
    currentData.status = 'connected';
    console.log('Подключено к устройству Modbus TCP по адресу:', config.modbus.host);
    
    return true;
  } catch (error) {
    currentData.status = 'error';
    console.error('Ошибка подключения к устройству Modbus TCP:', error);
    
    // Планирование повторного подключения через 10 секунд
    setTimeout(() => {
      connectToDevice();
    }, 10000);
    
    return false;
  }
}

// Запуск периодического опроса устройства
function startPolling(io) {
  // Функция опроса
  const poll = async () => {
    try {
      if (!client.isOpen) {
        await connectToDevice();
        return;
      }
      
      // Чтение значения веса как int16
      const weightResponse = await client.readHoldingRegisters(config.modbus.registers.weight, 1);
      const rawWeight = weightResponse.data[0];
      const weightInt16 = convertToInt16(rawWeight);
      
      // Чтение сигнала dispatch
      const dispatchResponse = await client.readHoldingRegisters(config.modbus.registers.dispatch, 1);
      const dispatch = dispatchResponse.data[0];
      
      // Чтение состояний входных танков - чтение битов
      const inputTanksState = {};
      let activeInputTank = null;
      let activeInputCount = 0;
      
      for (const tank of config.tanks.input) {
        const registerName = tank.registerName;
        const register = config.modbus.registers[registerName];
        
        const response = await client.readHoldingRegisters(register, 1);
        // Получаем значение бита (0 или 1)
        const value = response.data[0] & 0x0001; // Используем битовую маску для получения младшего бита
        
        const tankKey = `tank${tank.id}`;
        inputTanksState[tankKey] = {
          dumping: value,
          name: tank.name,
          currentWeight: currentData.inputTanks[tankKey].currentWeight
        };
        
        if (value === 1) {
          activeInputCount++;
          activeInputTank = tankKey;
        }
      }
      
      // Чтение состояний выходных танков - чтение битов
      const outputTanksState = {};
      let activeOutputTank = null;
      let activeOutputCount = 0;
      
      for (const tank of config.tanks.output) {
        const registerName = tank.registerName;
        const register = config.modbus.registers[registerName];
        
        const response = await client.readHoldingRegisters(register, 1);
        // Получаем значение бита (0 или 1)
        const value = response.data[0] & 0x0001; // Используем битовую маску для получения младшего бита
        
        const tankKey = `tank${tank.id}`;
        outputTanksState[tankKey] = {
          active: value,
          name: tank.name,
          currentWeight: currentData.outputTanks[tankKey].currentWeight
        };
        
        if (value === 1) {
          activeOutputCount++;
          activeOutputTank = tankKey;
        }
      }
      
      // Проверка на ошибки
      let error = null;
      
      if (activeInputCount > 1) {
        error = 'Открыто более одного входного танка';
      } else if (activeOutputCount > 1) {
        error = 'Открыто более одного выходного танка';
      } else if (dispatch === 1 && (activeInputCount === 0 || activeOutputCount === 0)) {
        error = 'Сигнал dispatch без активных танков';
      }
      
      // Обработка операции перемещения (dispatch)
      if (dispatch === 1 && currentData.dispatch === 0 && !error) {
        // Сохраняем вес перед операцией
        lastWeightBeforeDispatch = weightInt16;
        console.log(`Начало операции перемещения, сохранен вес: ${lastWeightBeforeDispatch} кг`);
      } else if (dispatch === 0 && currentData.dispatch === 1 && !error) {
        // Операция завершена, вычисляем перемещенный вес
        const transferredWeight = lastWeightBeforeDispatch;
        
        console.log(`Завершение операции перемещения, перемещенный вес: ${transferredWeight} кг`);
        
        if (transferredWeight > 0 && activeInputTank && activeOutputTank) {
          // Обновляем вес в танках
          inputTanksState[activeInputTank].currentWeight -= transferredWeight;
          outputTanksState[activeOutputTank].currentWeight += transferredWeight;
          
          // Записываем операцию
          const operation = {
            timestamp: new Date(),
            weight: transferredWeight,
            fromTank: {
              id: activeInputTank.replace('tank', ''),
              name: inputTanksState[activeInputTank].name
            },
            toTank: {
              id: activeOutputTank.replace('tank', ''),
              name: outputTanksState[activeOutputTank].name
            }
          };
          
          transferOperations.push(operation);
          
          // Сохраняем операцию в архив немедленно
          archiveService.saveTransferOperation(operation)
            .then(success => {
              if (success) {
                console.log(`Операция перемещения ${transferredWeight} кг из ${operation.fromTank.name} в ${operation.toTank.name} успешно сохранена`);
              } else {
                console.error('Ошибка сохранения операции перемещения');
              }
            })
            .catch(err => {
              console.error('Ошибка сохранения операции перемещения:', err);
            });
          
          // Также сохраняем часовые данные немедленно, если есть операции
          if (hourlyData.length > 0) {
            const currentHourData = [...hourlyData]; // Создаем копию для сохранения
            archiveService.saveHourlyData(currentHourData)
              .then(success => {
                if (success) {
                  console.log(`Часовые данные с операцией перемещения ${transferredWeight} кг успешно сохранены`);
                } else {
                  console.error('Ошибка сохранения часовых данных');
                }
              })
              .catch(err => {
                console.error('Ошибка сохранения часовых данных:', err);
              });
          }
        } else {
          console.warn(`Невозможно выполнить операцию перемещения: вес=${transferredWeight}, входной танк=${activeInputTank}, выходной танк=${activeOutputTank}`);
        }
      }
      
      // Обновление текущих данных
      currentData = {
        weight: rawWeight,
        weightInt16: weightInt16,
        dispatch,
        status: 'connected',
        timestamp: new Date(),
        inputTanks: inputTanksState,
        outputTanks: outputTanksState,
        activeTanks: {
          input: activeInputTank,
          output: activeOutputTank
        },
        error
      };
      
      // Добавление данных в часовой архив
      hourlyData.push({
        ...currentData,
        timestamp: new Date()
      });
      
      // Отправка обновленных данных через WebSocket
      if (io) {
        io.emit('currentData', currentData);
      }
      
    } catch (error) {
      console.error('Ошибка опроса устройства Modbus:', error);
      currentData.status = 'error';
      currentData.error = 'Ошибка связи с устройством';
      
      // Отправка информации об ошибке через WebSocket
      if (io) {
        io.emit('currentData', currentData);
      }
      
      // Попытка переподключения
      await connectToDevice();
    }
  };
  
  // Запуск периодического опроса
  const pollInterval = setInterval(poll, config.modbus.pollInterval);
  
  // Запуск сохранения часовых данных каждый час
  setInterval(async () => {
    if (hourlyData.length > 0) {
      await archiveService.saveHourlyData(hourlyData);
      hourlyData = []; // Очистка после сохранения
    }
  }, 60 * 60 * 1000); // Каждый час
  
  // Запуск сохранения операций перемещения каждые 5 минут
  setInterval(async () => {
    if (transferOperations.length > 0) {
      await archiveService.saveTransferOperations(transferOperations);
      transferOperations = []; // Очистка после сохранения
    }
  }, 5 * 60 * 1000); // Каждые 5 минут
  
  // Первоначальный опрос
  poll();
  
  return pollInterval;
}

// Получение текущих данных
function getCurrentData() {
  return {...currentData};
}

// Получение конфигурации
function getConfig() {
  return {...config};
}

// Обновление состояния танков после корректировки
function updateTanksState(inputTanks, outputTanks) {
  try {
    // Обновляем входные танки
    if (inputTanks) {
      Object.keys(inputTanks).forEach(key => {
        if (currentData.inputTanks[key]) {
          currentData.inputTanks[key] = {
            ...currentData.inputTanks[key],
            ...inputTanks[key]
          };
        }
      });
    }
    
    // Обновляем выходные танки
    if (outputTanks) {
      Object.keys(outputTanks).forEach(key => {
        if (currentData.outputTanks[key]) {
          currentData.outputTanks[key] = {
            ...currentData.outputTanks[key],
            ...outputTanks[key]
          };
        }
      });
    }
    
    console.log('Состояние танков обновлено после корректировки');
    
    // Также обновляем начальные веса в конфигурации
    // для сохранения при перезапуске сервера
    Object.keys(currentData.inputTanks).forEach((key, index) => {
      const tankId = parseInt(key.replace('tank', ''));
      const tankConfig = config.tanks.input.find(t => t.id === tankId);
      
      if (tankConfig) {
        tankConfig.initialWeight = currentData.inputTanks[key].currentWeight;
      }
    });
    
    Object.keys(currentData.outputTanks).forEach((key, index) => {
      const tankId = parseInt(key.replace('tank', ''));
      const tankConfig = config.tanks.output.find(t => t.id === tankId);
      
      if (tankConfig) {
        tankConfig.initialWeight = currentData.outputTanks[key].currentWeight;
      }
    });
    
    // Сохраняем обновленную конфигурацию в файл
    saveConfig(config);
    
    return true;
  } catch (error) {
    console.error('Ошибка обновления состояния танков:', error);
    return false;
  }
}

// Сохранение операции перемещения
function createTransferOperation(sourceId, destinationId, weight) {
  console.log(`Создание операции перемещения из ${sourceId} в ${destinationId}, вес: ${weight} кг`);
  
  // Убедимся, что ID представлены в правильном формате
  const formattedSourceId = typeof sourceId === 'number' ? sourceId.toString() : sourceId;
  const formattedDestId = typeof destinationId === 'number' ? destinationId.toString() : destinationId;
  
  // Получаем информацию о емкостях
  const sourceTank = config.tanks.input.find(t => t.id === parseInt(formattedSourceId));
  const destTank = config.tanks.output.find(t => t.id === parseInt(formattedDestId));
  
  // Записываем начальные веса
  const sourceInitialWeight = sourceTank ? parseFloat(sourceTank.initialWeight.toFixed(2)) : 0;
  const destInitialWeight = destTank ? parseFloat(destTank.initialWeight.toFixed(2)) : 0;
  
  // Создаем объект операции
  const operation = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    sourceId: formattedSourceId,
    sourceName: sourceTank ? sourceTank.name : `Емкость ${formattedSourceId}`,
    sourceInitialWeight,
    destinationId: formattedDestId,
    destinationName: destTank ? destTank.name : `Емкость ${formattedDestId}`,
    destinationInitialWeight,
    weight: parseFloat(weight.toFixed(2)),
    status: 'running'
  };
  
  // Устанавливаем текущую операцию
  currentData.transferOperation = operation;
  console.log('Создана операция перемещения:', JSON.stringify(operation));
  
  return operation;
}

// Функция проверки завершения операции перемещения
function checkTransferCompletion() {
  if (!currentData.transferOperation) {
    return false;
  }
  
  const operation = currentData.transferOperation;
  
  // Получаем ID емкостей
  const sourceId = operation.sourceId;
  const destId = operation.destinationId;
  
  // Проверяем, что емкости существуют
  const sourceTank = config.tanks.input.find(t => t.id === parseInt(sourceId));
  const destTank = config.tanks.output.find(t => t.id === parseInt(destId));
  
  if (!sourceTank || !destTank) {
    console.warn(`Не удалось найти емкости для операции: источник ${sourceId}, получатель ${destId}`);
    return false;
  }
  
  // Получаем текущие веса
  const sourceWeight = sourceTank.currentWeight;
  const destWeight = destTank.currentWeight;
  
  // Получаем начальные веса из операции
  const sourceInitialWeight = operation.sourceInitialWeight;
  const destInitialWeight = operation.destinationInitialWeight;
  
  // Рассчитываем изменение веса
  const sourceDelta = sourceInitialWeight - sourceWeight;
  const destDelta = destWeight - destInitialWeight;
  
  // Проверяем условия завершения:
  // 1. Прошло достаточно времени с начала операции (минимум 10 секунд)
  const minOpTime = 10; // в секундах
  const timeElapsed = moment().diff(moment(operation.timestamp), 'seconds');
  
  // 2. Вес источника уменьшился примерно на указанный в операции вес
  const sourceThreshold = 0.9 * operation.weight; // 90% от заданного веса
  
  // 3. Вес получателя увеличился примерно на указанный вес
  const destThreshold = 0.8 * operation.weight; // 80% от заданного веса (потери при перемещении)
  
  // Логируем процесс проверки
  console.log(`Проверка завершения операции:
    - Время операции: ${timeElapsed} сек (минимум ${minOpTime} сек)
    - Изменение веса источника: ${sourceDelta.toFixed(2)} кг (ожидается ${operation.weight} кг)
    - Изменение веса получателя: ${destDelta.toFixed(2)} кг (ожидается ${operation.weight} кг)
    - Пороговое значение источника: ${sourceThreshold.toFixed(2)} кг
    - Пороговое значение получателя: ${destThreshold.toFixed(2)} кг
  `);
  
  // Проверяем условия завершения
  const timeCondition = timeElapsed >= minOpTime;
  const sourceCondition = sourceDelta >= sourceThreshold;
  const destCondition = destDelta >= destThreshold;
  
  // Операция считается завершенной, если прошло достаточно времени и одно из условий по весу выполнено
  const isComplete = timeCondition && (sourceCondition || destCondition);
  
  if (isComplete) {
    console.log('Операция считается завершенной по следующим причинам:');
    console.log(`- Прошло достаточно времени: ${timeCondition ? 'Да' : 'Нет'}`);
    console.log(`- Достаточное уменьшение веса источника: ${sourceCondition ? 'Да' : 'Нет'}`);
    console.log(`- Достаточное увеличение веса получателя: ${destCondition ? 'Да' : 'Нет'}`);
  }
  
  return isComplete;
}

// Чтение всех регистров устройства
async function readAllRegisters() {
  // Проверяем подключение
  if (!client.isOpen) {
    await connectToDevice();
    return;
  }
  
  try {
    // Чтение значения веса как int16
    const weightResponse = await client.readHoldingRegisters(config.modbus.registers.weight, 1);
    const rawWeight = weightResponse.data[0];
    const weightInt16 = convertToInt16(rawWeight);
    
    // Чтение сигнала dispatch
    const dispatchResponse = await client.readHoldingRegisters(config.modbus.registers.dispatch, 1);
    const dispatch = dispatchResponse.data[0];
    
    // Чтение состояний входных танков
    const inputTanksState = {};
    let activeInputTank = null;
    let activeInputCount = 0;
    
    for (const tank of config.tanks.input) {
      const registerName = tank.registerName;
      const register = config.modbus.registers[registerName];
      
      const response = await client.readHoldingRegisters(register, 1);
      const value = response.data[0] & 0x0001;
      
      const tankKey = `tank${tank.id}`;
      inputTanksState[tankKey] = {
        dumping: value,
        name: tank.name,
        currentWeight: currentData.inputTanks[tankKey].currentWeight
      };
      
      if (value === 1) {
        activeInputCount++;
        activeInputTank = tankKey;
      }
    }
    
    // Чтение состояний выходных танков
    const outputTanksState = {};
    let activeOutputTank = null;
    let activeOutputCount = 0;
    
    for (const tank of config.tanks.output) {
      const registerName = tank.registerName;
      const register = config.modbus.registers[registerName];
      
      const response = await client.readHoldingRegisters(register, 1);
      const value = response.data[0] & 0x0001;
      
      const tankKey = `tank${tank.id}`;
      outputTanksState[tankKey] = {
        active: value,
        name: tank.name,
        currentWeight: currentData.outputTanks[tankKey].currentWeight
      };
      
      if (value === 1) {
        activeOutputCount++;
        activeOutputTank = tankKey;
      }
    }
    
    // Обновляем временные данные для использования в updateDeviceState
    currentData.tempData = {
      weightInt16,
      dispatch,
      inputTanksState,
      outputTanksState,
      activeInputTank,
      activeOutputTank,
      activeInputCount,
      activeOutputCount
    };
    
    return true;
  } catch (error) {
    console.error('Ошибка чтения регистров:', error);
    return false;
  }
}

// Обновление состояния устройства на основе считанных регистров
function updateDeviceState() {
  // Проверяем, что данные были считаны
  if (!currentData.tempData) {
    console.error('Невозможно обновить состояние: данные регистров не считаны');
    return false;
  }
  
  try {
    const {
      weightInt16,
      dispatch,
      inputTanksState,
      outputTanksState,
      activeInputTank,
      activeOutputTank,
      activeInputCount,
      activeOutputCount
    } = currentData.tempData;
    
    // Проверка на ошибки
    let error = null;
    
    if (activeInputCount > 1) {
      error = 'Открыто более одного входного танка';
    } else if (activeOutputCount > 1) {
      error = 'Открыто более одного выходного танка';
    } else if (dispatch === 1 && (activeInputCount === 0 || activeOutputCount === 0)) {
      error = 'Сигнал dispatch без активных танков';
    }
    
    // Обновление текущих данных
    currentData = {
      ...currentData,
      weight: weightInt16,
      weightInt16: weightInt16,
      dispatch,
      status: 'connected',
      timestamp: new Date(),
      inputTanks: inputTanksState,
      outputTanks: outputTanksState,
      activeTanks: {
        input: activeInputTank,
        output: activeOutputTank
      },
      error
    };
    
    // Добавление данных в часовой архив
    hourlyData.push({
      ...currentData,
      timestamp: new Date()
    });
    
    // Очищаем временные данные
    delete currentData.tempData;
    
    return true;
  } catch (error) {
    console.error('Ошибка обновления состояния устройства:', error);
    return false;
  }
}

// Обновление выходных регистров устройства
async function updateOutputRegisters() {
  // Здесь можно реализовать запись в выходные регистры устройства
  // если это необходимо для вашей системы
  return true;
}

// Обработка операций перемещения (dispatch)
async function processDispatch() {
  try {
    // Шаг 1: Считываем все регистры и обновляем состояние устройства
    const registersRead = await readAllRegisters();
    if (!registersRead) {
      console.error('Не удалось считать регистры для обработки dispatch');
      return false;
    }
    
    const updateSuccess = updateDeviceState();
    if (!updateSuccess) {
      console.error('Не удалось обновить состояние устройства для обработки dispatch');
      return false;
    }
    
    // Шаг 2: Проверяем, идет ли операция перемещения
    if (currentData.dispatch !== 1) {
      return false; // Нет активного процесса перемещения
    }
    
    // Шаг 3: Получаем текущую операцию из хранилища
    let currentOperation = await getCurrentTransferOperation();
    
    // Если нет активной операции, создаем новую
    if (!currentOperation) {
      // Проверяем наличие активных танков
      if (!currentData.activeTanks.input || !currentData.activeTanks.output) {
        console.error('Нет активных танков для создания операции перемещения');
        return false;
      }
      
      // Создаем новую операцию перемещения
      const inputTank = currentData.activeTanks.input;
      const outputTank = currentData.activeTanks.output;
      
      currentOperation = {
        id: generateOperationId(),
        type: 'transfer',
        status: 'in_progress',
        startTime: new Date(),
        endTime: null,
        inputTank: {
          id: inputTank,
          name: currentData.inputTanks[inputTank].name,
          startWeight: currentData.inputTanks[inputTank].currentWeight
        },
        outputTank: {
          id: outputTank,
          name: currentData.outputTanks[outputTank].name,
          startWeight: currentData.outputTanks[outputTank].currentWeight
        },
        transferredWeight: 0,
        measurements: []
      };
      
      // Сохраняем новую операцию
      await archiveService.saveTransferOperation(currentOperation);
    }
    
    // Добавляем новые измерения
    currentOperation.measurements.push({
      timestamp: new Date(),
      weight: currentData.weight,
      inputTank: currentData.activeTanks.input,
      outputTank: currentData.activeTanks.output
    });
    
    // Шаг 4: Проверка завершения операции
    const isComplete = await checkTransferCompletion(currentOperation);
    
    if (isComplete) {
      // Операция завершена - закрываем её
      const inputTankId = currentOperation.inputTank.id;
      const outputTankId = currentOperation.outputTank.id;
      
      // Обновляем данные операции
      currentOperation.status = 'completed';
      currentOperation.endTime = new Date();
      
      // Рассчитываем фактический перемещенный вес
      const inputTankStartWeight = currentOperation.inputTank.startWeight;
      const inputTankCurrentWeight = currentData.inputTanks[inputTankId].currentWeight;
      const outputTankStartWeight = currentOperation.outputTank.startWeight;
      const outputTankCurrentWeight = currentData.outputTanks[outputTankId].currentWeight;
      
      // Вес может быть рассчитан двумя способами, выбираем наиболее точный
      const inputWeightDelta = inputTankStartWeight - inputTankCurrentWeight;
      const outputWeightDelta = outputTankCurrentWeight - outputTankStartWeight;
      
      // Используем положительную дельту (обычно должны быть примерно одинаковыми)
      currentOperation.transferredWeight = Math.max(inputWeightDelta, outputWeightDelta);
      
      // Архивация операции
      await archiveService.saveTransferOperation(currentOperation);
      
      // Обновляем состояние танков
      await updateTanksState();
      
      console.log(`Операция перемещения ${currentOperation.id} завершена успешно`);
      return true;
    } else {
      // Операция все еще в процессе - обновляем её
      await archiveService.saveTransferOperation(currentOperation);
      return false;
    }
  } catch (error) {
    console.error('Ошибка при обработке операции перемещения:', error);
    return false;
  }
}

// Функция для генерации ID операции
function generateOperationId() {
  return `transfer_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Получение текущей операции перемещения
async function getCurrentTransferOperation() {
  try {
    const operations = await archiveService.readTransferOperations();
    
    // Находим незавершенную операцию перемещения
    const currentOperation = operations.find(op => 
      op.type === 'transfer' && op.status === 'in_progress'
    );
    
    return currentOperation || null;
  } catch (error) {
    console.error('Ошибка получения текущей операции перемещения:', error);
    return null;
  }
}

// Периодическая обработка запросов
async function pollDevice() {
  try {
    // Чтение всех регистров и обновление состояния устройства
    const readSuccess = await readAllRegisters();
    if (readSuccess) {
      updateDeviceState();
    } else {
      console.error('Не удалось считать регистры устройства');
      currentData.status = 'error';
      currentData.error = 'Ошибка чтения регистров';
      
      // Отправка информации об ошибке через WebSocket
      if (io) {
        io.emit('currentData', currentData);
      }
      
      // Попытка переподключения
      await connectToDevice();
      return;
    }
    
    // Обработка операций перемещения
    await processDispatch();
    
    // Отправка обновленных данных через WebSocket
    if (io) {
      io.emit('currentData', currentData);
    }
  } catch (error) {
    console.error('Ошибка опроса устройства Modbus:', error);
    currentData.status = 'error';
    currentData.error = 'Ошибка связи с устройством';
    
    // Отправка информации об ошибке через WebSocket
    if (io) {
      io.emit('currentData', currentData);
    }
    
    // Попытка переподключения
    await connectToDevice();
  }
}

// Обновление показаний веса
async function updateWeight() {
  try {
    // Проверяем подключение
    if (!client.isOpen) {
      await connectToDevice();
      return false;
    }
    
    // Чтение значения веса как int16
    const weightResponse = await client.readHoldingRegisters(config.modbus.registers.weight, 1);
    const rawWeight = weightResponse.data[0];
    const weightInt16 = convertToInt16(rawWeight);
    
    // Обновляем только значение веса в текущих данных
    currentData.weight = weightInt16;
    currentData.weightInt16 = weightInt16;
    currentData.timestamp = new Date();
    
    return true;
  } catch (error) {
    console.error('Ошибка обновления веса:', error);
    return false;
  }
}

// Экспорт функций модуля
module.exports = {
  init,
  connectToDevice,
  saveConfig,
  getCurrentData,
  getConfig,
  updateTanksState,
  createTransferOperation,
  checkTransferCompletion,
  processDispatch,
  updateWeight,
  readAllRegisters,
  updateDeviceState
};
