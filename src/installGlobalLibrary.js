/*
  * Copyright (c) 2021-2022 LG Electronics Inc.
  * SPDX-License-Identifier: Apache-2.0
*/
const vscode = require('vscode');
let { addLibrary, installEnactTemplate } = require('./lib/runCommand');
const notify = require('./lib/notificationUtils');
const { InputChecker } = require('./lib/inputChecker');
const libraryList = ["@enact/cli", "@webosose/ares-cli", "patch-package"];
const libraryPrompt = {
    "@enact/cli": `@enact/cli Global package adding in progress. This may take few minutes, Please wait...`,
    "@webosose/ares-cli": `@webosose/ares-cli Global package adding in progress...`,
    "patch-package": `patch-package Global package adding in progress...`
}
const command = "npm install -g @enact/cli @webosose/ares-cli patch-package"

async function installGlobalLibrary() {
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Install Global Packages",
        cancellable: false
    }, async (progress, token) => {
        token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
        });
        try {
            await notify.showProgress(progress, 1, `Instalation initiated..`);
            let pw = "";
            if (process.platform == "darwin") {
                await notify.showProgress(progress, 5, `Please enter Sudo password in top input field.`);
                pw = await getSudoPassword();
                if (pw) {
                    for (let i = 0; i < libraryList.length; i++) {
                        await notify.showProgress(progress, 10, libraryPrompt[`${libraryList[i]}`]);

                        await addLibrary(true, libraryList[i], pw);
                        await notify.showProgress(progress, 10, `${libraryList[i]} Global package adding Completed.`);
                    }
                    await installEnactTemplate();
                    vscode.commands.executeCommand('webososeDevices.refreshList');
                    await notify.clearProgress(progress, `Success! All Package installed`);
                    return Promise.resolve();
                }
            } else {
                for (let i = 0; i < libraryList.length; i++) {
                    await notify.showProgress(progress, 10, libraryPrompt[`${libraryList[i]}`]);

                    await addLibrary(true, libraryList[i]);
                    await notify.showProgress(progress, 10, `${libraryList[i]} Global package adding Completed.`);
                }
                await installEnactTemplate();
                vscode.commands.executeCommand('webososeDevices.refreshList');
                await notify.clearProgress(progress, `Success! All Package installed`);
                return Promise.resolve();
            }
        } catch (err) {
            let erMsg = err.toString();
            vscode.window.showErrorMessage(`ERROR! Failed to install package.
                Please install manually these packages ${libraryList}.
                Details As follows: ${erMsg}`);
            await notify.clearProgress(progress, `ERROR! Failed to install package.`);
            return Promise.reject(err);
        }
    });
}

async function showPrompt() {
    await vscode.window.showInformationMessage(
        `This extension needs following packages to be installed globally, ${libraryList}.
             Click ???????????? to approve installing them, else install them manually using following command,
             ${command}`,
        ...["Yes", "No"]
    )
        .then(async (answer) => {
            if (answer === "Yes") {
                installGlobalLibrary();
            } else {
                vscode.window.showInformationMessage(`Please install manually these packages using NPM command, ${command}`);
            }
        });
}

async function getSudoPassword() {
    return new Promise((resolve, reject) => {
        vscode.window.showInputBox({
            title: 'Admin Password to Install dependent Global Packages',
            placeHolder: `Entered password will be used only once to install packages & never saved.`,
            prompt: 'Enter your Admin password',
            password: true,
            ignoreFocusOut: true,
            validateInput: InputChecker.checkPassword
        }).then(value => {
            if (value === undefined) {
                reject("User Cancelled");
            } else {
                resolve(value);
            }
        });
    });
}

module.exports = {
    installGlobalLibrary: installGlobalLibrary,
    showPrompt: showPrompt,
    getSudoPassword: getSudoPassword
}
