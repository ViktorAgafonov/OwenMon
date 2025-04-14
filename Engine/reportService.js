// Сервис для генерации отчетов в формате XLS
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');
const moment = require('moment');
const archiveService = require('./archiveService');

// Путь для сохранения отчетов
const REPORTS_DIR = path.join(__dirname, '../reports');

// Инициализация сервиса
async function init() {
  try {
    // Создание директории для отчетов, если она не существует
    await fs.ensureDir(REPORTS_DIR);
    return true;
  } catch (error) {
    console.error('Ошибка инициализации сервиса отчетов:', error);
    return false;
  }
}

// Генерация отчета по смене
async function generateShiftReport(date, shiftNumber) {
  try {
    // Получение данных архива смены
    const shiftArchives = await archiveService.getShiftArchives(date);
    const shiftData = shiftArchives.find(archive => archive.shift == shiftNumber);
    
    if (!shiftData) {
      throw new Error(`Архив для смены ${shiftNumber} за дату ${date} не найден`);
    }
    
    // Создание нового файла Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OwenMon';
    workbook.lastModifiedBy = 'OwenMon';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Добавление листа для общей информации
    const summarySheet = workbook.addWorksheet('Сводка по смене');
    
    // Настройка заголовков
    summarySheet.columns = [
      { header: 'Параметр', key: 'parameter', width: 30 },
      { header: 'Значение', key: 'value', width: 20 }
    ];
    
    // Стиль для заголовков
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Добавление информации о смене
    const shiftStartTime = moment(shiftData.startTime);
    const shiftEndTime = moment(shiftData.endTime);
    
    summarySheet.addRow(['Отчет по перемещениям продукта']);
    summarySheet.addRow(['Дата', moment(date).format('DD.MM.YYYY')]);
    summarySheet.addRow(['Смена', `${shiftNumber} (${shiftData.shiftName})`]);
    summarySheet.addRow(['Время смены', `${shiftStartTime.format('HH:mm')} - ${shiftEndTime.format('HH:mm')}`]);
    summarySheet.addRow(['Всего операций перемещения', shiftData.transferStats.totalOperations]);
    summarySheet.addRow(['Общий вес перемещенного продукта', `${Math.round(shiftData.transferStats.totalWeight)} кг`]);
    
    // Форматирование заголовка
    summarySheet.mergeCells('A1:B1');
    summarySheet.getCell('A1').font = { bold: true, size: 16 };
    summarySheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Добавление информации о входных танках
    summarySheet.addRow([]);
    summarySheet.addRow(['Входные танки (источники)']);
    
    for (const tankId in shiftData.transferStats.byInputTank) {
      const tankStats = shiftData.transferStats.byInputTank[tankId];
      summarySheet.addRow([
        `${tankStats.name}`,
        `${Math.round(tankStats.totalWeight)} кг (${tankStats.operations} операций)`
      ]);
    }
    
    // Добавление информации о выходных танках
    summarySheet.addRow([]);
    summarySheet.addRow(['Выходные танки (приемники)']);
    
    for (const tankId in shiftData.transferStats.byOutputTank) {
      const tankStats = shiftData.transferStats.byOutputTank[tankId];
      summarySheet.addRow([
        `${tankStats.name}`,
        `${Math.round(tankStats.totalWeight)} кг (${tankStats.operations} операций)`
      ]);
    }
    
    // Форматирование заголовков разделов
    const headerRows = [8, 12]; // Строки с заголовками разделов
    headerRows.forEach(row => {
      summarySheet.getCell(`A${row}`).font = { bold: true, size: 14 };
      summarySheet.mergeCells(`A${row}:B${row}`);
    });
    
    // Добавление листа с детальной информацией о перемещениях
    const detailsSheet = workbook.addWorksheet('Детали перемещений');
    
    // Настройка заголовков
    detailsSheet.columns = [
      { header: '№', key: 'index', width: 5 },
      { header: 'Время', key: 'time', width: 20 },
      { header: 'Из танка', key: 'fromTank', width: 25 },
      { header: 'В танк', key: 'toTank', width: 25 },
      { header: 'Вес (кг)', key: 'weight', width: 15 }
    ];
    
    // Стиль для заголовков
    detailsSheet.getRow(1).font = { bold: true };
    detailsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Добавление данных о перемещениях
    if (shiftData.transferOperations && shiftData.transferOperations.length > 0) {
      shiftData.transferOperations.forEach((op, index) => {
        detailsSheet.addRow([
          index + 1,
          moment(op.timestamp).format('DD.MM.YYYY HH:mm:ss'),
          op.fromTank.name,
          op.toTank.name,
          op.weight
        ]);
      });
    } else {
      detailsSheet.addRow(['-', '-', 'Нет данных о перемещениях', '-', '-']);
      detailsSheet.mergeCells('C2:C2');
    }
    
    // Применение стилей к таблице
    detailsSheet.getColumn('A').alignment = { horizontal: 'center' };
    detailsSheet.getColumn('B').alignment = { horizontal: 'center' };
    detailsSheet.getColumn('E').alignment = { horizontal: 'right' };
    
    // Добавление границ таблицы
    for (let i = 1; i <= detailsSheet.rowCount; i++) {
      const row = detailsSheet.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Добавление листа с текущим состоянием танков
    const tanksSheet = workbook.addWorksheet('Состояние танков');
    
    // Настройка заголовков
    tanksSheet.columns = [
      { header: 'Тип', key: 'type', width: 15 },
      { header: 'Название', key: 'name', width: 25 },
      { header: 'Текущий вес (кг)', key: 'weight', width: 20 },
      { header: 'Статус', key: 'status', width: 15 }
    ];
    
    // Стиль для заголовков
    tanksSheet.getRow(1).font = { bold: true };
    tanksSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Получение последнего состояния танков
    const latestTanksState = await archiveService.getLatestTanksState();
    
    if (latestTanksState) {
      // Добавление данных о входных танках
      Object.keys(latestTanksState.tanks.input).forEach(tankKey => {
        const tank = latestTanksState.tanks.input[tankKey];
        tanksSheet.addRow([
          'Входной',
          tank.name,
          Math.round(tank.currentWeight),
          tank.dumping === 1 ? 'Активен' : 'Неактивен'
        ]);
      });
      
      // Добавление данных о выходных танках
      Object.keys(latestTanksState.tanks.output).forEach(tankKey => {
        const tank = latestTanksState.tanks.output[tankKey];
        tanksSheet.addRow([
          'Выходной',
          tank.name,
          Math.round(tank.currentWeight),
          tank.active === 1 ? 'Активен' : 'Неактивен'
        ]);
      });
      
      // Добавление времени последнего обновления
      tanksSheet.addRow([]);
      tanksSheet.addRow(['Время обновления', moment(latestTanksState.timestamp).format('DD.MM.YYYY HH:mm:ss'), '', '']);
      tanksSheet.mergeCells('B' + tanksSheet.rowCount + ':D' + tanksSheet.rowCount);
    } else {
      tanksSheet.addRow(['', 'Нет данных о состоянии танков', '', '']);
      tanksSheet.mergeCells('B2:D2');
    }
    
    // Применение стилей к таблице
    tanksSheet.getColumn('A').alignment = { horizontal: 'center' };
    tanksSheet.getColumn('C').alignment = { horizontal: 'right' };
    tanksSheet.getColumn('D').alignment = { horizontal: 'center' };
    
    // Добавление границ таблицы
    for (let i = 1; i <= tanksSheet.rowCount - 2; i++) {
      const row = tanksSheet.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Создание имени файла
    const fileName = `Отчет_Смена_${shiftNumber}_${moment(date).format('YYYY-MM-DD')}.xlsx`;
    const filePath = path.join(REPORTS_DIR, fileName);
    
    // Сохранение файла
    await workbook.xlsx.writeFile(filePath);
    
    console.log(`Отчет сохранен: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Ошибка генерации отчета по смене:', error);
    throw error;
  }
}

// Генерация отчета по танку за период
async function generateTankReport(tankType, tankId, startDate, endDate) {
  try {
    // Загрузка конфигурации
    const configPath = path.join(__dirname, '../config/config.json');
    const config = await fs.readJson(configPath);
    
    // Получение информации о танке
    const tanksConfig = tankType === 'input' ? config.tanks.input : config.tanks.output;
    const tank = tanksConfig.find(t => t.id == tankId);
    
    if (!tank) {
      throw new Error(`Танк с ID ${tankId} не найден в конфигурации`);
    }
    
    // Создание нового файла Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OwenMon';
    workbook.lastModifiedBy = 'OwenMon';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Добавление листа
    const worksheet = workbook.addWorksheet('Отчет по танку');
    
    // Настройка заголовков
    worksheet.columns = [
      { header: '№', key: 'index', width: 5 },
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'Время', key: 'time', width: 10 },
      { header: tankType === 'input' ? 'Выход из танка' : 'Вход в танк', key: 'operation', width: 15 },
      { header: tankType === 'input' ? 'В танк' : 'Из танка', key: 'otherTank', width: 25 },
      { header: 'Вес (кг)', key: 'weight', width: 15 }
    ];
    
    // Стиль для заголовков
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Добавление информации о танке
    worksheet.addRow([]);
    worksheet.addRow(['Отчет по танку']);
    worksheet.addRow([`Тип танка: ${tankType === 'input' ? 'Входной' : 'Выходной'}`]);
    worksheet.addRow([`Название танка: ${tank.name}`]);
    worksheet.addRow([`Период: ${moment(startDate).format('DD.MM.YYYY')} - ${moment(endDate).format('DD.MM.YYYY')}`]);
    worksheet.addRow([]);
    
    // Объединение ячеек для заголовка
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A3').font = { bold: true, size: 16 };
    worksheet.getCell('A3').alignment = { horizontal: 'center' };
    
    // Получение операций перемещения за указанный период
    const startMoment = moment(startDate).startOf('day');
    const endMoment = moment(endDate).endOf('day');
    
    let allOperations = [];
    let currentDate = startMoment.clone();
    
    // Сбор операций за каждый день в указанном диапазоне
    while (currentDate.isSameOrBefore(endMoment)) {
      const dateStr = currentDate.format('YYYY-MM-DD');
      const dayOperations = await archiveService.getTransferOperations(dateStr);
      allOperations = [...allOperations, ...dayOperations];
      currentDate.add(1, 'day');
    }
    
    // Фильтрация операций по танку
    const filteredOperations = allOperations.filter(op => {
      if (tankType === 'input') {
        return op.fromTank.id === `tank${tankId}`;
      } else {
        return op.toTank.id === `tank${tankId}`;
      }
    });
    
    // Сортировка операций по времени
    filteredOperations.sort((a, b) => moment(a.timestamp).diff(moment(b.timestamp)));
    
    // Добавление данных об операциях
    let rowIndex = 8; // Начальный индекс для данных
    let dataIndex = 1; // Счетчик записей
    
    // Добавление заголовка таблицы данных
    worksheet.addRow(['№', 'Дата', 'Время', 
      tankType === 'input' ? 'Выход из танка' : 'Вход в танк', 
      tankType === 'input' ? 'В танк' : 'Из танка', 
      'Вес (кг)']);
    worksheet.getRow(rowIndex).font = { bold: true };
    worksheet.getRow(rowIndex).alignment = { horizontal: 'center' };
    rowIndex++;
    
    // Добавление данных по операциям
    if (filteredOperations.length > 0) {
      let totalWeight = 0;
      
      filteredOperations.forEach(op => {
        const timestamp = moment(op.timestamp);
        const date = timestamp.format('DD.MM.YYYY');
        const time = timestamp.format('HH:mm:ss');
        const weight = op.weight;
        const otherTankName = tankType === 'input' ? op.toTank.name : op.fromTank.name;
        
        worksheet.addRow([dataIndex, date, time, tank.name, otherTankName, weight]);
        dataIndex++;
        rowIndex++;
        totalWeight += weight;
      });
      
      // Добавление итоговой строки
      worksheet.addRow(['', '', '', '', 'ИТОГО:', totalWeight]);
      worksheet.getRow(rowIndex).font = { bold: true };
      worksheet.getCell(`F${rowIndex}`).font = { bold: true };
    } else {
      worksheet.addRow(['', '', 'Нет данных о перемещениях для указанного танка', '', '', '']);
      worksheet.mergeCells(`C${rowIndex}:E${rowIndex}`);
      worksheet.getCell(`C${rowIndex}`).alignment = { horizontal: 'center' };
    }
    
    // Применение стилей к таблице данных
    worksheet.getColumn('A').alignment = { horizontal: 'center' };
    worksheet.getColumn('B').alignment = { horizontal: 'center' };
    worksheet.getColumn('C').alignment = { horizontal: 'center' };
    worksheet.getColumn('F').alignment = { horizontal: 'right' };
    
    // Добавление границ таблицы
    for (let i = 8; i <= rowIndex; i++) {
      const row = worksheet.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Создание имени файла
    const fileName = `Отчет_Танк_${tank.name.replace(/\s+/g, '_')}_${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}.xlsx`;
    const filePath = path.join(REPORTS_DIR, fileName);
    
    // Сохранение файла
    await workbook.xlsx.writeFile(filePath);
    
    console.log(`Отчет по танку сохранен: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Ошибка генерации отчета по танку:', error);
    throw error;
  }
}

// Генерация общего отчета за период
async function generatePeriodReport(startDate, endDate) {
  try {
    // Загрузка конфигурации
    const configPath = path.join(__dirname, '../config/config.json');
    const config = await fs.readJson(configPath);
    
    // Создание нового файла Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OwenMon';
    workbook.lastModifiedBy = 'OwenMon';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Добавление листа для сводной информации
    const summarySheet = workbook.addWorksheet('Сводка');
    
    // Настройка заголовков
    summarySheet.columns = [
      { header: 'Параметр', key: 'parameter', width: 30 },
      { header: 'Значение', key: 'value', width: 20 }
    ];
    
    // Стиль для заголовков
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Добавление информации о периоде
    summarySheet.addRow(['Общий отчет по перемещениям продукта']);
    summarySheet.addRow(['Период', `${moment(startDate).format('DD.MM.YYYY')} - ${moment(endDate).format('DD.MM.YYYY')}`]);
    
    // Получение операций перемещения за указанный период
    const startMoment = moment(startDate).startOf('day');
    const endMoment = moment(endDate).endOf('day');
    
    let allOperations = [];
    let currentDate = startMoment.clone();
    
    // Сбор операций за каждый день в указанном диапазоне
    while (currentDate.isSameOrBefore(endMoment)) {
      const dateStr = currentDate.format('YYYY-MM-DD');
      const dayOperations = await archiveService.getTransferOperations(dateStr);
      allOperations = [...allOperations, ...dayOperations];
      currentDate.add(1, 'day');
    }
    
    // Расчет общей статистики
    const totalWeight = allOperations.reduce((sum, op) => sum + op.weight, 0);
    
    summarySheet.addRow(['Всего операций перемещения', allOperations.length]);
    summarySheet.addRow(['Общий вес перемещенного продукта', `${Math.round(totalWeight)} кг`]);
    
    // Статистика по входным танкам
    const inputTankStats = {};
    const outputTankStats = {};
    
    allOperations.forEach(op => {
      const fromTankId = op.fromTank.id;
      const toTankId = op.toTank.id;
      
      // Статистика по входным танкам
      if (!inputTankStats[fromTankId]) {
        inputTankStats[fromTankId] = {
          name: op.fromTank.name,
          totalWeight: 0,
          operations: 0
        };
      }
      
      inputTankStats[fromTankId].totalWeight += op.weight;
      inputTankStats[fromTankId].operations += 1;
      
      // Статистика по выходным танкам
      if (!outputTankStats[toTankId]) {
        outputTankStats[toTankId] = {
          name: op.toTank.name,
          totalWeight: 0,
          operations: 0
        };
      }
      
      outputTankStats[toTankId].totalWeight += op.weight;
      outputTankStats[toTankId].operations += 1;
    });
    
    // Добавление информации о входных танках
    summarySheet.addRow([]);
    summarySheet.addRow(['Входные танки (источники)']);
    
    for (const tankId in inputTankStats) {
      const tankStats = inputTankStats[tankId];
      summarySheet.addRow([
        `${tankStats.name}`,
        `${Math.round(tankStats.totalWeight)} кг (${tankStats.operations} операций)`
      ]);
    }
    
    // Добавление информации о выходных танках
    summarySheet.addRow([]);
    summarySheet.addRow(['Выходные танки (приемники)']);
    
    for (const tankId in outputTankStats) {
      const tankStats = outputTankStats[tankId];
      summarySheet.addRow([
        `${tankStats.name}`,
        `${Math.round(tankStats.totalWeight)} кг (${tankStats.operations} операций)`
      ]);
    }
    
    // Форматирование заголовка
    summarySheet.mergeCells('A1:B1');
    summarySheet.getCell('A1').font = { bold: true, size: 16 };
    summarySheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Форматирование заголовков разделов
    const headerRows = [6, 10]; // Строки с заголовками разделов
    headerRows.forEach(row => {
      summarySheet.getCell(`A${row}`).font = { bold: true, size: 14 };
      summarySheet.mergeCells(`A${row}:B${row}`);
    });
    
    // Добавление листа с детальной информацией о перемещениях
    const detailsSheet = workbook.addWorksheet('Детали перемещений');
    
    // Настройка заголовков
    detailsSheet.columns = [
      { header: '№', key: 'index', width: 5 },
      { header: 'Дата', key: 'date', width: 12 },
      { header: 'Время', key: 'time', width: 10 },
      { header: 'Из танка', key: 'fromTank', width: 25 },
      { header: 'В танк', key: 'toTank', width: 25 },
      { header: 'Вес (кг)', key: 'weight', width: 15 }
    ];
    
    // Стиль для заголовков
    detailsSheet.getRow(1).font = { bold: true };
    detailsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Сортировка операций по времени
    allOperations.sort((a, b) => moment(a.timestamp).diff(moment(b.timestamp)));
    
    // Добавление данных о перемещениях
    if (allOperations.length > 0) {
      allOperations.forEach((op, index) => {
        const timestamp = moment(op.timestamp);
        detailsSheet.addRow([
          index + 1,
          timestamp.format('DD.MM.YYYY'),
          timestamp.format('HH:mm:ss'),
          op.fromTank.name,
          op.toTank.name,
          op.weight
        ]);
      });
    } else {
      detailsSheet.addRow(['-', '-', '-', 'Нет данных о перемещениях', '-', '-']);
      detailsSheet.mergeCells('D2:D2');
    }
    
    // Применение стилей к таблице
    detailsSheet.getColumn('A').alignment = { horizontal: 'center' };
    detailsSheet.getColumn('B').alignment = { horizontal: 'center' };
    detailsSheet.getColumn('C').alignment = { horizontal: 'center' };
    detailsSheet.getColumn('F').alignment = { horizontal: 'right' };
    
    // Добавление границ таблицы
    for (let i = 1; i <= detailsSheet.rowCount; i++) {
      const row = detailsSheet.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Создание имени файла
    const fileName = `Общий_отчет_${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}.xlsx`;
    const filePath = path.join(REPORTS_DIR, fileName);
    
    // Сохранение файла
    await workbook.xlsx.writeFile(filePath);
    
    console.log(`Общий отчет сохранен: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Ошибка генерации общего отчета:', error);
    throw error;
  }
}

// Создание отчета по корректировкам веса силосов
async function createWeightCorrectionReport(startDate, endDate) {
  try {
    // Получение всех корректировок за указанный период
    const corrections = await archiveService.getWeightCorrections(startDate, endDate);
    
    if (corrections.length === 0) {
      throw new Error('Нет данных о корректировках весов за указанный период');
    }
    
    // Создание новой книги Excel
    const workbook = new ExcelJS.Workbook();
    
    // Добавление информации о формировании отчета
    workbook.creator = 'OwenMon';
    workbook.lastModifiedBy = 'OwenMon';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Создание листа для отчета по корректировкам
    const worksheet = workbook.addWorksheet('Корректировки веса силосов');
    
    // Установка заголовков
    worksheet.columns = [
      { header: '№', key: 'index', width: 5 },
      { header: 'Дата и время', key: 'timestamp', width: 20 },
      { header: 'Причина', key: 'reason', width: 30 },
      { header: 'Тип силоса', key: 'tankType', width: 15 },
      { header: 'Название', key: 'name', width: 20 },
      { header: 'Установленный вес (кг)', key: 'weight', width: 20 }
    ];
    
    // Стиль для заголовка
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Добавление данных о корректировках
    let rowIndex = 1;
    
    // Обработка корректировок
    corrections.forEach((correction, index) => {
      const timestamp = moment(correction.correction.timestamp).format('DD.MM.YYYY HH:mm:ss');
      const reason = correction.correction.reason;
      
      // Обработка входных силосов
      correction.tanks.input.forEach(tank => {
        rowIndex++;
        worksheet.addRow({
          index: index + 1,
          timestamp: timestamp,
          reason: reason,
          tankType: 'Входной силос',
          name: tank.name,
          weight: tank.initialWeight
        });
      });
      
      // Обработка выходных танков
      correction.tanks.output.forEach(tank => {
        rowIndex++;
        worksheet.addRow({
          index: index + 1,
          timestamp: timestamp,
          reason: reason,
          tankType: 'Промежуточный',
          name: tank.name,
          weight: tank.initialWeight
        });
      });
    });
    
    // Настройка форматирования для заголовка
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Настройка границ для ячеек
    for (let i = 1; i <= rowIndex; i++) {
      worksheet.getRow(i).eachCell({ includeEmpty: false }, function(cell) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Формирование заголовка отчета
    worksheet.insertRow(1).values = [
      `Отчет по корректировкам веса силосов за период ${moment(startDate).format('DD.MM.YYYY')} - ${moment(endDate).format('DD.MM.YYYY')}`
    ];
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Добавление метаданных отчета
    worksheet.insertRow(2).values = [
      `Сформирован: ${moment().format('DD.MM.YYYY HH:mm:ss')}`
    ];
    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').alignment = { horizontal: 'right' };
    
    // Пустая строка для разделения
    worksheet.insertRow(3, []);
    
    // Возвращаем рабочую книгу
    return workbook;
  } catch (error) {
    console.error('Ошибка создания отчета по корректировкам веса:', error);
    throw error;
  }
}

// Экспорт функций модуля
module.exports = {
  init,
  generateShiftReport,
  generateTankReport,
  generatePeriodReport,
  createWeightCorrectionReport
};
