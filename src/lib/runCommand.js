/*
  * Copyright (c) 2021-2022 LG Electronics Inc.
  * SPDX-License-Identifier: Apache-2.0
*/
const path = require('path');
const { exec, spawn } = require('child_process');
const systemPlatform = require('os').platform();
const { getCliPath, getBrowserPath } = require('./configUtils');
const os = require('os');
const tcpPortUsed = require('tcp-port-used');
const defaultGateway = require('default-gateway');

function _execAsync(cmd, option, next) {
    return new Promise((resolve, reject) => {
        let execOption = {};
        if (typeof option == "function") {
            next = option;
        } else if (typeof option == "object") {
            execOption = option;
        }

        exec(cmd, execOption, (err, stdout, stderr) => {
            if (err) {
                if (stderr.includes('not recognized') || stderr.includes('not found')) {
                    const { showPrompt } = require('../installGlobalLibrary');
                    showPrompt();
                    reject("Global Package needed");
                } else {
                    reject(stderr);
                }
            } else {
                if (next) {
                    next(stdout, resolve, reject);
                } else {
                    resolve(stdout);
                }
            }
        })
    })
}

function _execServer(cmd, params) {
    return new Promise((resolve, reject) => {
        console.log(`runCommand_execServer: ${cmd}`);
        const myArr = params.split(" ");
        var child = spawn(cmd, myArr, {
            // @ts-ignore
            encoding: 'utf8',
            shell: true,
            maxBuffer: 1024 * 1024
        });
        // @ts-ignore
        child.stdout.on('data', (data) => {
            if (data.includes('http://localhost')) {
                let startIndex = data.indexOf('http');
                let finishIndex = data.indexOf('\n');
                let url = data.slice(startIndex, finishIndex);
                resolve([url, child]);
            } else if (data.includes('localhost:')) {
                let startIndex = 0;
                let finishIndex = data.indexOf('(');
                let url = data.slice(startIndex, finishIndex);
                resolve([url, child]);
            }
        });
        // @ts-ignore
        child.stderr.on('data', (data) => {
            console.error(data);
            reject(data);
        });
        child.on('error', (err) => {
            console.error('Failed to start subprocess.');
            console.error(err);
            reject(err);
        });
        child.on('close', (code, signal) => {
            console.log(
                `child process terminated due to receipt of signal ${signal}`);
            reject(signal);
        });
    })
}

function _execPreviewServer(cmd, params, cwd, port) {
    return new Promise((resolve, reject) => {
        const myArr = params.split(" ");

        var sysIP = getNWAdderss(os.networkInterfaces())
        var child = spawn(cmd, myArr, {
            // @ts-ignore
            cwd: cwd,
            shell: true,
        });

        child.stdout.on('data', () => {
            tcpPortUsed.check(port, sysIP)
                .then(() => {
                    resolve(["http://" + sysIP + ":" + port, child]);
                }, function (err) {
                    console.log('Error on port status:', err.message);
                });
        });

        // @ts-ignore
        child.stderr.on('data', (data) => {
            console.error(data);
            // reject(data);
        });
        child.on('error', (err) => {
            console.error('Failed to start subprocess.', err);
            reject(err);
        });
        child.on('close', (code, signal) => {
            console.log(
                `child process terminated due to receipt of signal ${signal}`);
            reject(signal);
        });
    })
}
function getNWAdderss(networkInterfaces) {
    const { interface } = defaultGateway.v4.sync();
    for (let i = 0; i < networkInterfaces[interface].length; i++) {
        let addrEntity = networkInterfaces[interface][i]
        if (addrEntity["family"] == "IPv4" && !addrEntity["internal"]) {
            return addrEntity["address"]
        }
    }
    return "127.0.0.1"
}

async function generate(template, properties, appDir) {
    if (!template || !properties || !appDir) {
        return Promise.reject('ares-generate: arguments are not fulfilled.')
    }
    let cliPath = await getCliPath();
    let cmd = `${path.join(cliPath, 'ares-generate')} -t ${template} -p "${JSON.stringify(properties).replace(/"/g, "'")}" "${appDir}"`;
    try {
        let result = await _execAsync(cmd);
        if (result.includes('Success')) {
            return Promise.resolve();
        }
    } catch (e) {
        console.error('ares-generate: failed!', e);
        return Promise.reject('ares-generate: failed!');
    }
}

async function setupDeviceList() {
    let cmd = `${path.join(await getCliPath(), 'ares-setup-device')} -F`;

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('emulator')) {
            resolve(stdout);
        } else {
            reject('ares-setup-device --listfull: failed!')
        }
    });
}

async function setupDeviceAdd(name, info) {
    if (!name || !info) {
        return Promise.reject('ares-setup-device --add: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-setup-device')} -a "${name}" -i "${JSON.stringify(info).replace(/"/g, "'")}"`;
    return _execAsync(cmd);
}

async function setupDeviceModify(name, info) {
    if (!name || !info) {
        return Promise.reject('ares-setup-device --modify: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-setup-device')} -m "${name}" -i "${JSON.stringify(info).replace(/"/g, "'")}"`;
    return _execAsync(cmd);
}

async function setupDeviceRemove(name) {
    if (!name) {
        return Promise.reject('ares-setup-device --remove: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-setup-device')} -r "${name}"`;
    return _execAsync(cmd);
}

async function pack(appDir, outDir, minify, serviceDir) {
    let dirString = appDir;
    let minifyOption = minify ? '' : '-n';

    let cmd = `${path.join(await getCliPath(), 'ares-package')} "${dirString}"`;
    if (serviceDir)
        cmd += ` "${serviceDir}"`;
    cmd += ` -o "${outDir}" ${minifyOption}`;

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('Success')) {
            let ipkIndex = stdout.indexOf('.ipk');
            let ipkFile = stdout.slice(7, ipkIndex + 4);
            resolve(ipkFile);
        } else {
            reject('ares-package: failed!');
        }
    })
}

async function packInfo(ipkPath) {
    let option = '-i';

    let cmd = `${path.join(await getCliPath(), 'ares-package')} "${option}"`;
    cmd += ` "${ipkPath}"`;

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('Package Information')) {
            console.log()
            resolve(stdout);
        } else {
            reject('ares-package: analyze info failed!');
        }
    })
}

async function install(appFilePath, device) {
    if (!appFilePath) {
        return Promise.reject('ares-install: arguments are not fulfilled.')
    }

    let cmd = `${path.join(await getCliPath(), 'ares-install')} "${appFilePath}"`;

    if (device) {
        cmd += ` -d "${device}"`;
    }

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('Success')) {
            resolve();
        } else {
            reject('ares-install: failed!');
        }
    })
}

async function installList(device) {
    if (!device) {
        return Promise.reject('ares-install --list: arguments are not fulfilled.')
    }

    let cmd = `${path.join(await getCliPath(), 'ares-install')} -l -d "${device}"`;

    return _execAsync(cmd);
}
async function checkDeviceOnline(device) {
    if (!device) {
        return Promise.reject('ares-shell: arguments are not fulfilled.')
    }

    let cmd = `${path.join(await getCliPath(), 'ares-shell')} -d "${device}" -r "echo checking online"`;

    return _execAsync(cmd);
}
async function installRemove(appId, device) {
    if (!appId || !device) {
        return Promise.reject('ares-install --remove: arguments are not fulfilled.')
    }

    let cmd = `${path.join(await getCliPath(), 'ares-install')} -r ${appId} -d "${device}"`;

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('Removed package')) {
            resolve();
        } else {
            reject('ares-install --remove: failed!');
        }
    });
}

async function launch(appId, device, params, dp) {
    if (!appId || !device) {
        return Promise.reject('ares-launch: arguments are not fulfilled.')
    }

    let paramsStr = params ? `-p "${JSON.stringify(params).replace(/"/g, "'")}"` : "";
    let cmd = `${path.join(await getCliPath(), 'ares-launch')} ${appId} -d "${device}" ${paramsStr} -dp "${dp}"`;

    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('Launched application')) {
            resolve();
        } else {
            reject('ares-launch: failed!');
        }
    })
}

async function launchRunning(device) {
    if (!device) {
        return Promise.reject('ares-launch --running: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-launch')} -r -d "${device}"`;
    return _execAsync(cmd);
}

async function launchClose(appId, device, dp) {
    if (!appId || !device) {
        return Promise.reject('ares-launch --close: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-launch')} -c ${appId} -d "${device}" -dp "${dp}"`;
    return _execAsync(cmd, (stdout, resolve, reject) => {

        if (stdout.includes('Closed application')) {
            resolve();
        } else {
            reject('ares-launch --close: failed!');
        }
    });
}

async function server(appDir, isEnact, port) {
    if (!appDir) {
        return Promise.reject('ares-server: arguments are not fulfilled.')
    }
    let cmd = "";

    if (isEnact) {
        cmd = "enact serve -p " + port;
        let params = "";
        return _execPreviewServer(cmd, params, path.join(appDir), port);

    } else {
        let params = `"${appDir}" -p ${port} `; // -o
        cmd = `${path.join(await getCliPath(), 'ares-server')}`;
        return _execPreviewServer(cmd, params, appDir, port);
    }
}

async function getLintResults(appDir, isEnact) {
    if (!appDir) {
        return Promise.reject('enact lint: arguments are not fulfilled.')
    }
    let cmd = "";
    if (isEnact) {
        cmd = "enact lint .";
        // cmd = `${path.join(appDir, 'enact lint .')}`;
        let param = appDir;
        return _execAsync(cmd, { cwd: param });

    }
    return Promise.reject('Lint is not supported for type of app.');
}

async function inspect(appId, device, isService) {
    if (!appId || !device) {
        return Promise.reject('ares-inspect: arguments are not fulfilled.')
    }
    let serviceTrue = "";
    if (isService) {
        serviceTrue = "-s";
    }
    let params = `${serviceTrue} ${appId} -d ${device}`;
    let cmd = `${path.join(await getCliPath(), 'ares-inspect')}`;

    return _execServer(cmd, params);
}

async function openBrowser(url) {
    const platformOpen = {
        win32: ['cmd', '/c', 'start'],
        darwin: ['open'],
        linux: ['google-chrome']
    };
    let browserPath = await getBrowserPath();
    let info = platformOpen[systemPlatform];
    let args = [];
    if (systemPlatform !== 'linux') {
        args = info.slice(1).concat([browserPath]);
    } else {
        args = args.concat(['--no-sandbox'])
    }
    if (systemPlatform === 'darwin') {
        args = args.concat(['--new', '--args']);
    }
    args = args.concat([url]);
    console.log(`openBrowser: ${info[0]} ${args}`);
    spawn(info[0], args);
}

async function deviceInfo(device) {
    if (!device) {
        return Promise.reject('ares-device info: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-device')} -i -d "${device}"`;
    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('webos')) {
            resolve(stdout);
        } else {
            reject('ares-device info: failed!');
        }
    })
}

async function setDefaultDevice(deviceLabel) {
    if (!deviceLabel) {
        return Promise.reject('ares-device info: arguments are not fulfilled.')
    }
    let cmd = `${path.join(await getCliPath(), 'ares-setup-device')} -f "${deviceLabel}"`;
    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes(`${deviceLabel} (default)`)) {
            resolve(stdout);
        } else {
            reject(`ares-setup-device -f ${deviceLabel}: command failed!`);
        }
    })
}
async function addLibrary(isGlobal, library, param) {
    let cmd = '';
    if (isGlobal) {
        if (!library) {
            return Promise.reject('npm: arguments are not fulfilled.')
        }
        if (param) {
            // in this case param is pw
            cmd = `echo ${param} | sudo -S npm install -g ${library}`;
        } else {
            cmd = `npm install -g ${library}`;
        }
        return _execAsync(cmd, (stdout, resolve, reject) => {
            if (stdout.includes('package')) {
                resolve();
            } else {
                reject('npm : failed!');
            }
        })
    } else {
        if (!param) {
            return Promise.reject('npm: arguments are not fulfilled.')
        }
        cmd = `npm install`;
        if (library) {
            cmd = `npm install ${library}  --save-prod`;
        }
        // param is nothing but app Dir
        return _execAsync(cmd, { cwd: param }, (stdout, resolve, reject) => {
            if (stdout.includes('package')) {
                resolve();
            } else {
                reject('npm : failed!');
            }
        })

    }
}
async function removeLibrary(isGlobal, library, appDir) {
    let cmd = '';
    if (isGlobal) {
        if (!library) {
            return Promise.reject('npm: arguments are not fulfilled.')
        }
        cmd = `npm install -g ${library}`;
    } else {
        if (!appDir || !library) {
            return Promise.reject('npm: arguments are not fulfilled.')
        }
        cmd = `npm uninstall ${library} --save --prefix  "${appDir}"`;
    }
    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('package')) {
            resolve();
        } else {
            reject('npm : failed!');
        }
    })
}
async function runInstall(appDir) {
    if (!appDir) {
        return Promise.reject('npm: arguments are not fulfilled.')
    }
    let cmd = `npm install --prefix  "${appDir}"`;
    return _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout.includes('package')) {
            resolve();
        } else {
            reject('npm : failed!');
        }
    })
}

async function installEnactTemplate() {
    let cmd = `enact template install @enact/template-moonstone`;
    return await _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout) {
            resolve();
        } else {
            reject('npm : failed!');
        }
    })
}
function addQuotes(name) {
    return name = "\"" + name + "\"";
}

async function isInstalledService(serviceId, device) {
    let cmd = 'ares-shell --run "test -d "/media/developer/apps/usr/palm/services/' + serviceId + '" && echo 1 || echo 0" -d ' + addQuotes(device);
    console.log(cmd);
    return await _execAsync(cmd, (stdout, resolve, reject) => {
        if (stdout) {
            stdout = parseInt(stdout);
            resolve(stdout);
        } else {
            reject('npm : failed!');
        }
    })
}

module.exports = {
    generate: generate,
    setupDeviceList: setupDeviceList,
    setupDeviceAdd: setupDeviceAdd,
    setupDeviceModify: setupDeviceModify,
    setupDeviceRemove: setupDeviceRemove,
    package: pack,
    packageInfo: packInfo,
    install: install,
    installList: installList,
    installRemove: installRemove,
    launch: launch,
    launchRunning: launchRunning,
    launchClose: launchClose,
    server: server,
    inspect: inspect,
    openBrowser: openBrowser,
    deviceInfo: deviceInfo,
    setDefaultDevice: setDefaultDevice,
    addLibrary: addLibrary,
    removeLibrary: removeLibrary,
    runInstall: runInstall,
    execAsync: _execAsync,
    installEnactTemplate: installEnactTemplate,
    isInstalledService: isInstalledService,
    getLintResults: getLintResults,
    checkDeviceOnline:checkDeviceOnline
}
