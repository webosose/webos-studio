/*
  * Copyright (c) 2021-2022 LG Electronics Inc.
  * SPDX-License-Identifier: Apache-2.0
*/
const vscode = require('vscode');
const { generateApp, generateAppFromProjectWizard, removeApp } = require('./src/generateApp');
const previewApp = require('./src/previewApp');
const reloadWebAppPreview = require('./src/reloadWebApp');
const packageApp = require('./src/packageApp');
const setupDevice = require('./src/setupDevice');
const runApp = require('./src/runApp');
const installApp = require('./src/installApp');
const launchApp = require('./src/launchApp');
const inspectApp = require('./src/inspectApp');
const lintApp = require('./src/lintApp');
const installLibrary = require('./src/installLibrary');
const { installGlobalLibrary } = require('./src/installGlobalLibrary');
const { DeviceProvider } = require('./src/webososeDevices');
const { AppsProvider } = require('./src/webososeApps');
const { uninstallApp, closeApp, getDeviceInfo, setDefaultDevice } = require('./src/contextMenus');
const { InstanceWebviewProvider } = require('./src/instanceWebviewProvider');
const { ExplorerMenuMgr } = require('./src/explorerMenuMgr');
const { getDefaultDir } = require('./src/lib/workspaceUtils');
const { InputChecker } = require('./src/lib/inputChecker');
const { HelpProvider, renderReadMe, renderChangeLog } = require('./src/helpProvider');
const { IPK_ANALYZER } = require('./src/ipkAnalyzer');

const fs = require('fs');
const path = require('path');
const extensionPath = __dirname;

let registerServiceList = [];
let svcArray= [];

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    let previewPanelInfo = { "webPanel": null, appDir: null, childProcess: null, isEnact: null };

    setFromConvertCacheAPI("");

    const serviceProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext','javascript', 'typescript', 'html'],
        {
            provideCompletionItems(document, position) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (!linePrefix.endsWith('luna://')) {
                    return undefined;
                }
                const returnItemArray = [];
                for (const i in registerServiceList) {
                    returnItemArray.push(new vscode.CompletionItem(registerServiceList[i], vscode.CompletionItemKind.Method));
                }
                return returnItemArray;
            }
        },
        '/' // triggered whenever a '/' is being typed
    );

    const methodProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext','javascript', 'typescript', 'html'],
        {
            provideCompletionItems(document, position) {
                let serviceName = "";
                const returnItemArray = [];
                const serviceArray = svcArray;
                const linePrefix = document.lineAt(position).text.substring(0, position.character);

                let found = false;
                for (const i in registerServiceList) {
                    serviceName = registerServiceList[i];
                    const endKeyword = registerServiceList[i].split(".");
                    const endService = endKeyword[endKeyword.length-1];

                    if (linePrefix.endsWith(`${endService}/`)) {
                        found = true;
                        break;
                    }
                }

                if (found === false ) {
                    return undefined;
                }

                // find matched service's object to get method lists.
                const findServiceIndex = svcArray.findIndex((element) => element["service"] === serviceName);
                if (findServiceIndex != -1) {
                    for (const i in serviceArray[findServiceIndex]["methods"]) {
                        returnItemArray.push(new vscode.CompletionItem(serviceArray[findServiceIndex]["methods"][i].substring(1), vscode.CompletionItemKind.Method));
                    }
                }
                return returnItemArray;
            }
        },
        '/' // triggered whenever a '/' is being typed
    );

    const snippetServiceProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext','javascript', 'typescript', 'html'], {

        provideCompletionItems() {
            const stringFirstMain = 'new LS2Request()';
            const firstSnippetCompletion = new vscode.CompletionItem(stringFirstMain);

            const stringFirstSub = 'new LS2Request().send({' + '\n'
                + '\t' + 'service: \'luna://' + '${1|'+ registerServiceList + '|}/\',' + '\n'
                + '\t' + 'method: \'${2}\',' + '\n'
                + '\t' + 'parameters: params' + '\n'
            + '});';

            firstSnippetCompletion.insertText = new vscode.SnippetString(stringFirstSub);

            const stringSecondMain = 'webOS.service.request()';
            const secondSnippetCompletion = new vscode.CompletionItem(stringSecondMain);
            const stringSecondSub = 'webOS.service.request(\'luna://' + '${1|'+ registerServiceList + '|}/\', {' + '\n'
                + '\t' + 'method: \'${2}\',' + '\n'
                + '\t' + 'parameters: {},' + '\n'
                + '\t' + 'onSuccess: {},' + '\n'
                + '\t' + 'onFailure: {},' + '\n'
            + '});';

            secondSnippetCompletion.insertText = new vscode.SnippetString(stringSecondSub);

            // return all completion items as array
            return [
                firstSnippetCompletion,
                secondSnippetCompletion
            ];
        }
    });

    const snippetMethodProvider = vscode.languages.registerCompletionItemProvider(
        ['plaintext','javascript', 'typescript', 'html'], {

        provideCompletionItems(document, position) {
            const returnItemArray = [];
            let serviceName = "";

            const linePrefix = document.lineAt(position.line-1).text;

            if (linePrefix.includes("service:") || linePrefix.includes("webOS.service.request")) {
                const lineSplit = linePrefix.split("luna://");
                const lineSplitEnd = lineSplit[lineSplit.length-1];
                if (lineSplitEnd.includes('/')) {
                    serviceName = lineSplitEnd.split("/")[0];
                }
                else {
                    serviceName = lineSplitEnd.split("'")[0];
                }

                const methodArr = snippetFindmethod(serviceName);
                for (const i in methodArr) {
                    returnItemArray.push(new vscode.CompletionItem(methodArr[i].substring(1), vscode.CompletionItemKind.Method));
                }
            }

            return returnItemArray;
        }
    });

    context.subscriptions.push(serviceProvider, methodProvider, snippetServiceProvider, snippetMethodProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('webosose.projectWizard', () => {
            const panel = vscode.window.createWebviewPanel('Wizard', 'Create Project', vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [
                  vscode.Uri.file(extensionPath)
                ]
            })

            let apiLevel, appType, appSubType, appTypeIndex, enactTemplate, htmlType, disposeFinish = false;
            let projectLocation, projectName, prop = {}, addWebOSlib = false;
            let checkAllValid, projectLocationValid;
            let msg = 'webOS Project Wizard';

            const resource = getResourcePath();

            panel.title = msg;
            panel.webview.html = getWebviewHome(resource);

            panel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'Generate':
                        appTypeIndex = 0;
                        apiLevel = message.apiLevel;
                        msg = 'Create Project';
                        panel.title = msg;
                        panel.webview.html = getWebviewCreateProject(appTypeIndex, resource); // page2
                        vscode.workspace.getConfiguration().update("webosose.lunaApiLevel", apiLevel);
                        setFromConvertCacheAPI(apiLevel);
                        break;
                    case 'Next':
                        appType = message.appType;
                        appSubType = message.appSubType;
                        appTypeIndex = message.appTypeIndex;
                        msg = 'Set ' + appSubType + ' of ' + appType + ' property';
                        panel.title = msg;
                        if (appType === 'Enact App') {
                             // Enact App type's sub Type is one of 'Sandstone' and 'Moonstone'
                             enactTemplate = appSubType.toLowerCase();
                        }
                        panel.webview.html = getWebviewPropertyPage(appSubType, appTypeIndex, resource);
                        break;
                    case 'Back':
                        htmlType = message.htmlType;
                        if (htmlType === 'home') {
                            msg = 'webOS Project Wizard';
                            panel.title = msg;
                            panel.webview.html = getWebviewHome(resource); // page1
                        } else if (htmlType === 'createproject') {
                            appTypeIndex = message.appTypeIndex;
                            msg = 'Create Project';
                            panel.title = msg;
                            panel.webview.html = getWebviewCreateProject(appTypeIndex, resource);
                        }
                        break;
                    case 'CheckNavi':
                        htmlType = message.htmlType;
                        if (htmlType === 'createproject') {
                            appTypeIndex = message.appTypeIndex;
                            msg = message.msg;
                            if (msg) {
                                vscode.window.showWarningMessage(msg);
                            }
                            msg = "Create Project";
                            panel.title = msg;
                            panel.webview.html = getWebviewCreateProject(appTypeIndex, resource);
                        }
                        break;
                    case 'ShowOpenDialog':
                        vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true
                        }).then(fileUri => {
                            if (fileUri && fileUri[0]) {
                                panel.webview.postMessage({ command: 'SetLocation', location : fileUri[0].fsPath});
                            }
                        });
                        break;
                    case 'Finish':
                        // Check validation at first
                        checkAllValid = true;
                        projectLocationValid = true;

                        for (const i in message['validcheckList']) {
                            msg = '';
                            if (!projectLocationValid && message['validcheckList'][i].valueType === 'name') {
                                // Set project name text color to origin color
                                await panel.webview.postMessage({
                                    command: 'UpdateValidList',
                                    valueType : message['validcheckList'][i].valueType,
                                    validResult : true
                                });
                                continue;
                            } else {
                                msg = InputChecker.checkFromProjectWizard(message['validcheckList'][i]);
                            }
                            if (msg) {
                                checkAllValid = false;

                                if (message['validcheckList'][i].valueType === 'location') {
                                    projectLocationValid = false;
                                }
                                let headerType = (message['validcheckList'][i].valueType).toUpperCase();
                                msg = `[${headerType}] ${msg}`;
                                vscode.window.showErrorMessage(msg);
                            }
                            await panel.webview.postMessage({
                                command: 'UpdateValidList',
                                valueType : message['validcheckList'][i].valueType,
                                validResult : ( !msg ? true : false)
                            });
                        }

                        // All values are valid. Generate Appp
                        if (checkAllValid) {
                            projectName = message.projectName;
                            projectLocation = message.projectLocation;

                            if (message.appId) {
                                prop.id = message.appId;
                            }
                            if (message.appVersion) {
                                prop.version = message.appVersion;
                            }
                            if (message.appTitle) {
                                prop.title = message.appTitle;
                            }
                            if (message.hostedUrl) {
                                prop.url = message.hostedUrl;
                            }
                            if (message.addWebOSlib) {
                                addWebOSlib = message.addWebOSlib;
                            }
                            if (appType === 'Enact App'){
                                appSubType = 'Basic Enact App';
                                prop.template = enactTemplate;
                            }

                            disposeFinish = true;
                            panel.dispose();
                        }
                        break;
                    case 'Cancel':
                        disposeFinish = false;
                        panel.dispose();
                        break;
                }
            }, undefined, this.disposable)

            panel.onDidDispose(() => {
                // Handle user closing panel after 'finish' botton clicked on Project Wizard
                if (disposeFinish) {
                    generateAppFromProjectWizard(appSubType, projectLocation, projectName, prop, addWebOSlib)
                        .then(() => {
                            webososeAppsProvider.refresh();
                        });
                    }
                },
                null,
                context.subscriptions
            );
		})
	);
    context.subscriptions.push(vscode.commands.registerCommand('webosose.installGlobal', () => {
        installGlobalLibrary();
    }));

    // Help Provide
    const helpPanels = new Map();
    const readmeCommand = vscode.commands.registerCommand('extensionHelp.readme', async () => {
        renderReadMe(helpPanels);
    });
    const changeLogCommand = vscode.commands.registerCommand('extensionHelp.changeLog', async () => {
        renderChangeLog(helpPanels);
    });
    const initHelpCommand = vscode.commands.registerCommand('extensionHelp.initHelp', async () => {
        await webososeHelpProvider.refresh();
    })

    context.subscriptions.push(readmeCommand);
    context.subscriptions.push(changeLogCommand);
    context.subscriptions.push(initHelpCommand);

    const webososeHelpProvider = new HelpProvider([
        { "label": "Readme", "onSelectCommand": "extensionHelp.readme", "icon": "info" },
        { "label": "Change Log", "onSelectCommand": "extensionHelp.changeLog", "icon": "versions" }
    ]);
    vscode.window.registerTreeDataProvider('extensionHelp', webososeHelpProvider);

    context.subscriptions.push(vscode.commands.registerCommand('webosose.generateApp', async () => {
        await generateApp();
        await webososeAppsProvider.refresh();
        webososeAppsProvider.storeContextOnExtnLaunch(context);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.previewApp', () => {
        previewApp(null, previewPanelInfo);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.packageApp', () => { packageApp(); }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.setupDevice', () => { setupDevice(); }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.installApp', () => {
        installApp()
            .then(() => {
                webososeDevicesProvider.refresh();
            });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.launchApp', () => {
        launchApp()
            .then(() => {
                webososeDevicesProvider.refresh();
            });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.inspectApp', () => { inspectApp(); }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.runApp', () => { runApp(); }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.debugApp', () => { runApp(true); }));

    const webososeDevicesProvider = new DeviceProvider();
    vscode.window.registerTreeDataProvider('webososeDevices', webososeDevicesProvider);

    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.refreshList', () => {
        webososeDevicesProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.addDevice', async () => {
        await setupDevice('add');
        webososeDevicesProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.modifyDevice', async (device) => {
        device = deviceClone(device);
        if (device != null) {
            await setupDevice('modify', device.label);
            webososeDevicesProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.removeDevice', async (device) => {
        device = deviceClone(device);
        if (device != null) {
            if (device.label === 'emulator') {
                vscode.window.showInformationMessage(`The emulator cannot be removed.`);
                return;
            }
            else {
                await setupDevice('remove', device.label);
                webososeDevicesProvider.refresh();
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.getDeviceInfo', (device) => {

        device = deviceClone(device);
        if (device != null) {
            getDeviceInfo(device.label);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.setDefaultDevice', async (device) => {

        device = deviceClone(device);
        if (device != null) {
            await setDefaultDevice(device.label);
            webososeDevicesProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.refreshDevice', (device) => {
        device = deviceClone(device);
        if (device != null) {
            webososeDevicesProvider.refresh(device);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.installApp', (device) => {
        device = deviceClone(device);
        if (device != null) {
            installApp(null, device.label)
                .then(() => {
                    webososeDevicesProvider.refresh(device);
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.runApp', (app) => {
        app = appClone(app);
        if (app != null) {
            launchApp(app.label, app.deviceName)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.runApp.display0', (app) => {
        app = appClone(app);
        if (app != null) {
            launchApp(app.label, app.deviceName, 0)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.runApp.display1', (app) => {
        app = appClone(app);
        if (app != null) {
            launchApp(app.label, app.deviceName, 1)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.uninstallApp', (app) => {
        app = appClone(app);
        if (app != null) {
            uninstallApp(app.label, app.deviceName)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.closeApp', (app) => {
        app = appClone(app);
        if (app != null) {
            closeApp(app.label, app.deviceName)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    })); // display0
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.closeApp.display0', (app) => {
        app = appClone(app);
        if (app != null) {
            closeApp(app.label, app.deviceName, 0)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webososeDevices.closeApp.display1', (app) => {
        app = appClone(app);
        if (app != null) {
            closeApp(app.label, app.deviceName, 1)
                .then(() => {
                    webososeDevicesProvider.refresh();
                })
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorer.installApp', (file) => {
        installApp(file.fsPath, null);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorer.runApp', (file) => {
        installApp(file.fsPath, null)
            .then((obj) => {
                launchApp(obj.appId, obj.device)
            })
    }));

    const webososeAppsProvider = new AppsProvider();
    vscode.window.registerTreeDataProvider('apps', webososeAppsProvider);
    context.subscriptions.push(vscode.commands.registerCommand('apps.refreshList', () => {
        webososeAppsProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.generateApp', async () => {
        await generateApp();
        await webososeAppsProvider.refresh();
        webososeAppsProvider.storeContextOnExtnLaunch(context);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.packageApp', async (app) => {
        packageApp(app.label);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.runApp', async (app) => {
        packageApp(app.label)
            .then(installApp)
            .then((obj) => {
                if (obj && obj.appId) {
                    launchApp(obj.appId)
                        .then(() => {
                            webososeDevicesProvider.refresh();
                        });
                }
            });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.removeApp', async (app) => {
        await removeApp(app);
        webososeAppsProvider.refresh();
        // webososeAppsProvider.storeContextOnExtnLaunch(context);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.installApp', async (app) => {
        packageApp(app.label, true) // if IPK already exists then skip the package steps
            .then(installApp)
            .then(() => {
                webososeDevicesProvider.refresh();
            });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('apps.installWebOS', async (app) => {
        installLibrary(app.label, app.description);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.previewApp', async (app) => {
        previewApp(app.label, previewPanelInfo);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.debugApp', async (app) => {
        inspectApp(app.label, undefined, true);
    }));
    // Provide Diagnostics when user performs lint.
    let collection = vscode.languages.createDiagnosticCollection('appLintCollection');
    context.subscriptions.push(vscode.commands.registerCommand('apps.lintApp', async (app) => {
        lintApp(app.label, collection, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('apps.lintAppDisable', async (app) => {
        lintApp(app.label, collection, false);
    }));
    vscode.workspace.onDidDeleteFiles(() => {
        webososeAppsProvider.refresh();
    });
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(function (doc) {
        // checking saved file is inside a webapp and preview is on 
        if (previewPanelInfo.appDir != null && previewPanelInfo.isEnact == false && doc.fileName.startsWith(previewPanelInfo.appDir)) {
            // relad the preview
            vscode.commands.executeCommand('webapp.reloadPreview', previewPanelInfo);
        }
        if (doc.fileName.endsWith("package.json")) {
            webososeAppsProvider.comparePackageJsonDependancies(context, doc)
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('webapp.reloadPreview', async (previewPanelInfo) => {
        reloadWebAppPreview(previewPanelInfo)
    }));

    const instanceWebviewProvider = new InstanceWebviewProvider(context.extensionUri);
    vscode.window.registerWebviewViewProvider(InstanceWebviewProvider.viewType, instanceWebviewProvider, { webviewOptions: { retainContextWhenHidden: true } });
    context.subscriptions.push(vscode.commands.registerCommand('vbox.refreshList', () => {
        instanceWebviewProvider.getInstalledInstanceListAndSendToWebview();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vbox.addInstance', () => {
        instanceWebviewProvider.openAddInstance();

    }));
    let explorerMenuMgr = new ExplorerMenuMgr();
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorermenu.packageApp', async (resource) => {
        explorerMenuMgr.packageApp(resource)
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorermenu.installApp', async (resource) => {
        explorerMenuMgr.installApp(resource)
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorermenu.runApp', async (resource) => {
        explorerMenuMgr.runApp(resource)
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorermenu.appPreview', async (resource) => {
        explorerMenuMgr.appPreview(resource)
    }));
    context.subscriptions.push(vscode.commands.registerCommand('webosose.explorermenu.debug', async (resource) => {
        explorerMenuMgr.debugApp(resource)
    }));

    context.subscriptions.push(vscode.commands.registerCommand('ipkanalyze.start', async () => {

        const ipkAnalyzer = new IPK_ANALYZER(context);
        ipkAnalyzer.startEditor();

    }));

    vscode.commands.executeCommand('webososeDevices.refreshList');
    webososeAppsProvider.storeContextOnExtnLaunch(context);
}

function getResourcePath() {
    const dataPath = vscode.Uri.file(extensionPath);
    const resource = dataPath.with({ scheme: 'vscode-resource' });

    return resource;
}

function setFromConvertCacheAPI(apiLevel) {
    let fileData = "";
    let apiLevelStatus = "";
    let apiLevelStatusSplit = [];
    if (apiLevel == "") {
        apiLevelStatus = vscode.workspace.getConfiguration().get("webosose.lunaApiLevel");
        if (apiLevelStatus.includes('#')) {
            apiLevelStatus = "OSE_APILevel_21";
            vscode.workspace.getConfiguration().update("webosose.lunaApiLevel", apiLevelStatus);
        }
    }
    else {
        apiLevelStatus = apiLevel;
    }
    apiLevelStatusSplit = apiLevelStatus.split("_");
    apiLevel = apiLevelStatusSplit[apiLevelStatusSplit.length-1];
    let jsonPath = path.join(__dirname, "resources/filterAPIByAPILevel_" + apiLevel + ".json");

    registerServiceList = [];
    svcArray = [];

    try {
        fileData = fs.readFileSync(jsonPath, 'utf8');
    }
    catch (e) {
        console.log("err " + e);
    }

    const jsonData= JSON.parse(fileData);
    const jsonDataServices = jsonData.services;
    const uriList = [];

    for (const key in jsonDataServices) {
        uriList.push(jsonDataServices[key].uri);
    }

    const servicesArray = [];

    for (const index in uriList) {
        let serviceName = "";
        let methodName = "";

        const words = uriList[index].split('/');
        if (words.length > 1) {
            serviceName = words[0];
            methodName = uriList[index].substring(serviceName.length);
            if (serviceName === "com.webos.service.power") { // Remove duplicated service
                continue;
            }
            if (serviceName.includes("palm")) { // Change the service name from palm to webos
                let replaceWord = "";
                if (serviceName.includes("service")) {
                    replaceWord = "webos";
                }
                else {
                    replaceWord = "webos.service";
                }
                serviceName = serviceName.replace("palm", replaceWord)
            }
            const lunaService = serviceName;
            if (registerServiceList.indexOf(lunaService) == -1) {
                registerServiceList.push(lunaService);
            }
        }

        const findServiceIndex = servicesArray.findIndex((element) => element["service"] === serviceName);

        // service name alreay exist in servicesArray
        if (findServiceIndex != -1) {
            if (servicesArray[findServiceIndex]["methods"].indexOf(methodName) == -1) {
                servicesArray[findServiceIndex]["methods"].push(methodName);
            }
        } else {
            // Add new service object including serviceName and method array.
            const serviceObj = {
                "service" : serviceName,
                "methods" : [methodName]
            };
            servicesArray.push(serviceObj);
        }
    }

    // Sort API array
    registerServiceList.sort();
    servicesArray.sort(function(a, b) {
        let x = a.service.toLowerCase();
        let y = b.service.toLowerCase();
        if (x < y) {
            return -1;
        }
        if (x > y) {
            return 1;
        }
        return 0;
    });

    // platform, product, APILevel information obejct would be removed later (TBD)
    const convertedApiObj = {
        "platform": "Ombre",
        "product": "OSE",
        "APILevel": apiLevel,
        "services" : servicesArray
    };

    svcArray = servicesArray;

    return convertedApiObj;
}

function snippetFindmethod(serviceName) {
    let servicemethod = [];
    const serviceArray = svcArray;
    const findServiceIndex = svcArray.findIndex((element) => element["service"] === serviceName);
    if (findServiceIndex != -1) {
        servicemethod = serviceArray[findServiceIndex]["methods"];
    }
    return servicemethod;
}

function getWebviewHome(resource) {
    const commonCssUri = resource + '/media/wizard/pageCommon.css';
    const cssUri = resource + '/media/wizard/pageHome.css';
    const scriptUri = resource + '/media/wizard/pageHome.js';
    const minHomeImg = resource + '/resources/wizard/start_logo_min.png';
    const maxHomeImg = resource + '/resources/wizard/start_logo_max.png';
    const selectRightIcon = resource + '/resources/wizard/select_right_icon.svg';
    return `<!DOCTYPE HTML>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Home</title>
        <link href="${cssUri}" rel="stylesheet">
        <link href="${commonCssUri}" rel="stylesheet">
        <script defer src="${scriptUri}" select-right-icon="${selectRightIcon}" \
            min-homeimg="${minHomeImg}" max-homeimg="${maxHomeImg}"></script>
    </head>
    <body>
        <div class="content" id="big-div" style="display: none; flex-direction: column; justify-content: center; align-items: center;">
            <a href="https://developer.lge.com/main/Intro.dev" target="_blank">
                <div class="img-large"></div>
            </a>

            <div class="grid-container-small">
                <label class="grid-container-label" for="selelct-webos-product">
                    webOS Product
                </label>
                <select name="selelct-webos-product" id="selelct-webos-product">
                        <option value="none" selected disabled hidden>====== select ======</option>
                        <option value="OSE">OSE</option>
                </select>
                <label class="grid-container-label" for="selelct-api-version">
                    API Version
                </label>
                <select name="selelct-api-version" id="selelct-api-version" disabled>
                        <option value="none" selected disabled hidden>====== select ======</option>
                        <option value="OSE_APILevel_21">OSE APILevel21</option>
                        <option value="OSE_APILevel_20">OSE APILevel20</option>
                </select>

                <label class="grid-container-label" for="description">
                    Description
                </label>

                <textarea id="description" name="description" readonly>
                </textarea>

            </div>

            <button id="btn-generate" class="btn-large" disabled>Generate Project</button>

        </div>
    </body>
    </html>`
}

function getWebviewCreateProject(appTypeIndex, resource) {
    const commonCssUri = resource + '/media/wizard/pageCommon.css';
    const commonExceptHomeCssUri = resource + '/media/wizard/pageCommonExceptHome.css';
    const cssUri = resource + '/media/wizard/pageCreateProject.css';
    const scriptUri = resource + '/media/wizard/pageCreateProject.js';

    const btnLeftIcon = resource + '/resources/wizard/btn_left_icon.svg';
    const btnLeftIconDisabled = resource + '/resources/wizard/btn_left_icon_disabled.svg';
    const btnRightIcon = resource + '/resources/wizard/btn_right_icon.svg';
    const btnRightIconDisabled = resource + '/resources/wizard/btn_right_icon_disabled.svg';

    const listAllIcon = resource + '/resources/wizard/list_all_icon.svg';
    const listRightIcon = resource + '/resources/wizard/list_right_icon.svg';
    const listAllIconHover = resource + '/resources/wizard/list_all_icon_hover.svg';
    const listRightIconHover = resource + '/resources/wizard/list_right_icon_hover.svg';

    const basicWebappImg = resource + '/resources/wizard/basic_webapp.png';
    const hostedWebappImg = resource + '/resources/wizard/hosted_webapp.png';

    const noImg = resource + '/resources/wizard/no_image.svg';
    const moonstoneEnactappImg = resource + '/resources/wizard/moonstone_enactapp.png';
    const sandstoneEnactappImg = resource + '/resources/wizard/sandstone_enactapp.png';
    return `<!DOCTYPE HTML>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test</title>
        <link href="${cssUri}" rel="stylesheet">
        <link href="${commonExceptHomeCssUri}" rel="stylesheet">
        <link href="${commonCssUri}" rel="stylesheet">
        <script defer src="${scriptUri}" btn-left-icon="${btnLeftIcon}" btn-left-icon-disabled="${btnLeftIconDisabled}" \
            btn-right-icon="${btnRightIcon}" btn-right-icon-disabled="${btnRightIconDisabled}" \
            list-all-icon="${listAllIcon}" list-all-icon-hover="${listAllIconHover}" \
            list-right-icon="${listRightIcon}" list-right-icon-hover="${listRightIconHover}" \
            basic-webappimg="${basicWebappImg}" hosted-webappimg="${hostedWebappImg}" no-img="${noImg}" \
            moonstone-enactappimg="${moonstoneEnactappImg}" sandstone-enactappimg="${sandstoneEnactappImg}" \
            app-type-index="${appTypeIndex}">
        </script>
    </head>
    <body>
        <div class="content" id="big-div" style="display: none; flex-direction: column; justify-content: center; align-items: center;">
            <div class="navi-top-left">
                <span class="navi-top-left-text">Project wizard</span>
            </div>
            <div class="navi-top-right">
                <span class="navi-top-right-text">Template</span>
            </div>
            <div class="navi-left">
                <ul id = "list-project-type">
                    <li class="li-left all-img">All</li>
                    <li class="li-left right-img">Web App</li>
                    <li class="li-left right-img">JS Service</li>
                    <li class="li-left right-img">Enact App</li>
                </ul>
            </div>
            <div class="navi-bottom">
            </div>
            <div class="navi-bottom-btn-box">
                <button id="btn-back" class="btn-small btn-small-1">
                    <span class="btn-small-img-1"></span>
                    <span class="btn-small-text btn-small-text-1">Back</span>
                </button>
                <button id="btn-cancel" class="btn-small btn-small-2">
                    <span class="btn-small-text btn-small-text-2">Cancel</span>
                </button>
                <button id="btn-next" class="btn-small btn-small-3">
                    <span class="btn-small-text btn-small-text-3">Next</span>
                    <span class="btn-small-img-3"></span>
                </button>
            </div>

            <div class="page-create-middle-left">
                <ul id = "list-project-sub-type">
                </ul>
            </div>
            <div class="page-create-middle-right">
                <img src="${noImg}" id="app-img" class="img-small">
                <div class="desc-title">
                    Description
                </div>
                <div class="desc-text" id="desc-text">
                    When you select a project, you can view the description of the project
                </div>
            </div>
        </div>
    </body>
    </html>`
}

// this method is called when your extension is deactivated
function deactivate() {}

function appClone(app) {
    if (app != null && app.label != null) {
        return JSON.parse(JSON.stringify(app))
    } else {
        return null
    }
}
function deviceClone(dev) {
    if (dev != null && dev.label != null) {
        return JSON.parse(JSON.stringify(dev))
    } else {
        return null
    }
}
module.exports = {
    activate,
    deactivate
}

function getWebviewPropertyPage(appType, appTypeIndex, resource) {
    const commonCssUri = resource + '/media/wizard/pageCommon.css';
    const commonExceptHomeCssUri = resource + '/media/wizard/pageCommonExceptHome.css';
    const cssUri = resource + '/media/wizard/pageProperty.css';
    const scriptUri = resource + '/media/wizard/pageProperty.js';
    let defaultDir = '';
    if (getDefaultDir()) {
        defaultDir = path.resolve(getDefaultDir());
    }

    const btnLeftIcon = resource + '/resources/wizard/btn_left_icon.svg';
    const btnLeftIconDisabled = resource + '/resources/wizard/btn_left_icon_disabled.svg';
    const btnRightIcon = resource + '/resources/wizard/btn_right_icon.svg';
    const btnRightIconDisabled = resource + '/resources/wizard/btn_right_icon_disabled.svg';

    const listAllIcon = resource + '/resources/wizard/list_all_icon.svg';
    const listRightIcon = resource + '/resources/wizard/list_right_icon.svg';
    const listAllIconHover = resource + '/resources/wizard/list_all_icon_hover.svg';
    const listRightIconHover = resource + '/resources/wizard/list_right_icon_hover.svg';

    return `<!DOCTYPE HTML>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test</title>
        <link href="${cssUri}" rel="stylesheet">
        <link href="${commonExceptHomeCssUri}" rel="stylesheet">
        <link href="${commonCssUri}" rel="stylesheet">
        <script defer src="${scriptUri}"  btn-left-icon="${btnLeftIcon}" btn-left-icon-disabled="${btnLeftIconDisabled}" \
            btn-right-icon="${btnRightIcon}" btn-right-icon-disabled="${btnRightIconDisabled}" \
            list-all-icon="${listAllIcon}" list-all-icon-hover="${listAllIconHover}" \
            list-right-icon="${listRightIcon}" list-right-icon-hover="${listRightIconHover}" \
            selected-type="${appType}" app-type-index="${appTypeIndex}" default-dir="${defaultDir}">
        </script>
    </head>
    <body>
        <div class="content" id="big-div" style="display: none; flex-direction: column; justify-content: center; align-items: center;">
            <div class="navi-top-left">
                <span class="navi-top-left-text">Project wizard</span>
            </div>
            <div class="navi-top-right">
                <span class="navi-top-right-text">Template</span>
            </div>
            <div class="navi-left">
                <ul id = "list-project-type">
                    <li class="li-left all-img">All</li>
                    <li class="li-left right-img">Web App</li>
                    <li class="li-left right-img">JS Service</li>
                    <li class="li-left right-img">Enact App</li>
                </ul>
            </div>
            <div class="navi-bottom">
            </div>
            <div class="navi-bottom-btn-box">
                <button id="btn-back" class="btn-small btn-small-1">
                    <span class="btn-small-img-1"></span>
                    <span class="btn-small-text btn-small-text-1">Back</span>
                </button>
                <button id="btn-cancel" class="btn-small btn-small-2">
                    <span class="btn-small-text btn-small-text-2">Cancel</span>
                </button>
                <button id="btn-finish" class="btn-small btn-small-3">
                    <span class="btn-small-text btn-small-text-2">Finish</span>
                </button>
            </div>
            <div id="middle">
                <div class="page-property-middle">
                    <div class="property-header" id="property-header">Basic Web Application
                    </div>
                        <div class="property-guide" id="property-guide">Insert Application Information
                    </div>  
                    <div class="grid-container" id="container">
                        <label class="grid-container-label" for="project-location-input">Project Location</label>
                        <div class="filebox">
                            <input class="upload-name" id="project-location-input" placeholder="Enter Project Location" style="width:215px">
                            <label id="project-location-select" >Browse</label>
                        </div>
                        <label class="grid-container-label" for="project-name-input">Project Name</label>
                        <input type="text" id="project-name-input" placeholder="Enter Project Name" style="width:298px">
                        <label class="grid-container-label" id="project-id-label" for="project-id-input">App ID</label>
                        <input type="text" id="project-id-input" style="width:298px">
                        <label class="grid-container-label" id="app-version-label" for="app-version-input">App Version</label>
                        <input type="text" id="app-version-input" style="width:298px">
                        <label class="grid-container-label" id="app-title-label" for="app-title-input">App title</label>
                        <input type="text" id="app-title-input" style="width:298px">
                        <label class="grid-container-label" id="hosted-url-label" for="hosted-url-input">Hosted url</label>
                        <input type="text" id="hosted-url-input" style="width:298px">
                        <label class="grid-container-label" id="webOS-library-label">Add webOS library</label>
                        <div id = "webOS-library-check">
                            <label class="check-container">Yes<input type="checkbox" id = "check-yes" checked>
                                <span class="checkmark"></span>
                            </label>
                            <label class="check-container">No<input type="checkbox" id = "check-no">
                                <span class="checkmark"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>`
}
