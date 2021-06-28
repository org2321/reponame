export interface ElectronWindow {
  electron: {
    chooseFilePath: (
      title: string,
      defaultPath: string
    ) => Promise<string | undefined>;
    openExternal: (url: string) => Promise<void>;
  };
}
