import { spawn } from 'node:child_process';

// Запуск Node.js скрипта с параметрами
const nodeProcess = spawn('node', ['--import=extensionless/register', './signalsExample.js'], {
    stdio: 'inherit', // Передает stdout/stderr в консоль
    cwd: process.cwd() // Текущая рабочая директория
});

nodeProcess.on('close', (code) => {
    console.log(`Процесс завершен с кодом: ${code}`);
});

nodeProcess.on('error', (error) => {
    console.error(`Ошибка запуска: ${error.message}`);
});
