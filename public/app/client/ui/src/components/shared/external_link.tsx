import React from "react";
import * as styles from "@styles";
import { ElectronWindow } from "@core/types/electron";

declare var window: ElectronWindow;

type Props = {
  to: string;
  className?: string;
};

export const ExternalLink: React.FC<Props> = ({ to, className, children }) => {
  return (
    <a
      onClick={(e) => {
        e.preventDefault();
        window.electron.openExternal(to).catch((err) => alert(err));
      }}
      className={styles.ExternalLink + (className ? " " + className : "")}
    >
      {children}
    </a>
  );
};
