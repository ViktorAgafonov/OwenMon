const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs-extra');

// Импорт модулей приложения
const modbusService = require('./Engine/modbusService');
const archiveService = require('./Engine/archiveService');
const reportService = require('./Engine/reportService');

// Инициализация приложения
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Настройка middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Создание необходимых директорий, если они не существуют
const dirs = [
  './archives/hourly', 
  './archives/shifts', 
  './archives/transfers', 
  './archives/tanks', 
  './config',
  './reports'
];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// API маршруты для текущих данных
app.get('/api/current', (req, res) => {
  const data = modbusService.getCurrentData();
  // Добавляем информацию о типе соединения, что используется TCP
  data.connectionInfo = {
    type: 'Modbus TCP',
    host: modbusService.getConfig().modbus.host,
    port: modbusService.getConfig().modbus.port
  };
  res.json(data);
});

// API маршруты для архивов
app.get('/api/archives/hourly', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  archiveService.getHourlyArchives(date)
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/archives/shifts', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  archiveService.getShiftArchives(date)
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/archives/transfers', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  archiveService.getTransferOperations(date)
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/archives/tanks/latest', (req, res) => {
  archiveService.getLatestTanksState()
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

// API маршруты для работы с состоянием танков
app.get('/api/tanks/state', (req, res) => {
  // Получаем текущее состояние танков из сервиса Modbus
  const currentData = modbusService.getCurrentData();
  const tanksState = {
    timestamp: new Date(),
    tanks: {
      input: currentData.inputTanks || {},
      output: currentData.outputTanks || {}
    }
  };
  res.json(tanksState);
});

// API маршрут для применения корректировки веса в силосах
app.post('/api/tanks/correction', (req, res) => {
  try {
    const correctionData = req.body;
    
    if (!correctionData || !correctionData.tanks || !correctionData.correction) {
      return res.status(400).json({ error: 'Некорректные данные для корректировки' });
    }
    
    // Сохраняем корректировку в архив
    archiveService.saveWeightCorrection(correctionData)
      .then(success => {
        if (success) {
          // Обновляем текущее состояние силосов и танков
          const inputTanks = {};
          const outputTanks = {};
          
          // Обновление входных силосов
          correctionData.tanks.input.forEach(tank => {
            const key = `tank${tank.id}`;
            inputTanks[key] = {
              name: tank.name,
              currentWeight: tank.initialWeight,
              dumping: 0
            };
          });
          
          // Обновление выходных танков
          correctionData.tanks.output.forEach(tank => {
            const key = `tank${tank.id}`;
            outputTanks[key] = {
              name: tank.name,
              currentWeight: tank.initialWeight,
              active: 0
            };
          });
          
          // Обновляем состояние в сервисе Modbus
          modbusService.updateTanksState(inputTanks, outputTanks);
          
          res.json({ success: true, message: 'Корректировка успешно применена' });
        } else {
          res.status(500).json({ error: 'Ошибка сохранения корректировки' });
        }
      })
      .catch(err => {
        console.error('Ошибка применения корректировки:', err);
        res.status(500).json({ error: err.message });
      });
  } catch (error) {
    console.error('Ошибка обработки запроса на корректировку:', error);
    res.status(500).json({ error: error.message });
  }
});

// API маршрут для получения истории корректировок
app.get('/api/tanks/corrections', (req, res) => {
  const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
  const endDate = req.query.endDate || startDate;
  
  archiveService.getWeightCorrections(startDate, endDate)
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

// API маршрут для отчета по корректировкам веса
app.get('/api/report/corrections', (req, res) => {
  const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
  const endDate = req.query.endDate || startDate;
  
  reportService.createWeightCorrectionReport(startDate, endDate)
    .then(workbook => {
      // Создание временного файла для отчета
      const fileName = `Корректировки_${startDate}_${endDate}.xlsx`;
      const filePath = path.join(__dirname, 'reports', fileName);
      
      // Запись файла
      return workbook.xlsx.writeFile(filePath)
        .then(() => filePath);
    })
    .then(filePath => {
      res.download(filePath);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

// API маршруты для отчетов
app.get('/api/report/shift', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const shift = req.query.shift || 1;
  
  reportService.generateShiftReport(date, shift)
    .then(filePath => {
      res.download(filePath);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/report/tank', (req, res) => {
  const tankType = req.query.type; // 'input' или 'output'
  const tankId = req.query.id;
  const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
  const endDate = req.query.endDate || startDate;
  
  if (!tankType || !tankId) {
    return res.status(400).json({ error: 'Не указан тип или ID танка' });
  }
  
  reportService.generateTankReport(tankType, tankId, startDate, endDate)
    .then(filePath => {
      res.download(filePath);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/report/period', (req, res) => {
  const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
  const endDate = req.query.endDate || startDate;
  
  reportService.generatePeriodReport(startDate, endDate)
    .then(filePath => {
      res.download(filePath);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

// API маршруты для конфигурации
app.get('/api/config', (req, res) => {
  const configPath = path.join(__dirname, 'config/config.json');
  fs.readJson(configPath)
    .then(data => res.json(data))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/config', (req, res) => {
  const configPath = path.join(__dirname, 'config/config.json');
  
  // Чтение текущей конфигурации
  fs.readJson(configPath)
    .then(currentConfig => {
      // Обновление только указанных разделов
      const updatedConfig = { ...currentConfig };
      
      if (req.body.modbus) {
        updatedConfig.modbus = { ...currentConfig.modbus, ...req.body.modbus };
      }
      
      if (req.body.tanks) {
        updatedConfig.tanks = { ...currentConfig.tanks, ...req.body.tanks };
      }
      
      if (req.body.shifts) {
        updatedConfig.shifts = req.body.shifts;
      }
      
      // Сохранение обновленной конфигурации
      return modbusService.saveConfig(updatedConfig);
    })
    .then(() => res.json({ success: true }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// API маршрут для проверки подключения Modbus
app.get('/api/modbus/test-connection', (req, res) => {
  modbusService.connectToDevice()
    .then(success => {
      if (success) {
        res.json({ success: true });
      } else {
        res.json({ success: false, error: 'Не удалось подключиться к устройству' });
      }
    })
    .catch(err => res.status(500).json({ success: false, error: err.message }));
});

// Настройка WebSocket для обновления данных в реальном времени
io.on('connection', (socket) => {
  console.log('Новое подключение WebSocket');
  
  // Отправка текущих данных при подключении
  socket.emit('currentData', modbusService.getCurrentData());
  
  socket.on('disconnect', () => {
    console.log('WebSocket отключен');
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  // Запуск сервиса Modbus
  modbusService.init(io);
  
  // Запуск сервиса архивирования
  archiveService.init();
  
  // Запуск сервиса отчетов
  reportService.init();
});
