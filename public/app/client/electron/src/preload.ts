import { contextBridge, remote } from "electron";
import { ElectronWindow } from "@core/types/electron";

const { dialog } = remote;

const exposeInterface: ElectronWindow["electron"] = {
  chooseFilePath: async (title, defaultPath) => {
    const { filePath } = await dialog.showSaveDialog({
      title,
      defaultPath,
    });
    return filePath;
  },
  openExternal: async (url: string) => remote.shell.openExternal(url),
};

contextBridge.exposeInMainWorld("electron", exposeInterface);
