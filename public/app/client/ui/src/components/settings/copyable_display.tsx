import React, { useState } from "react";
import { wait } from "@core/lib/utils/wait";

export const CopyableDisplay: React.FC<{
  label: string;
  value: string;
  copy: (v: string) => void;
  disableClasses?: true;
}> = ({ label, value, copy, disableClasses }) => {
  const [wasCopied, setWasCopied] = useState(false);
  const copyAndReset = async (value: string) => {
    copy(value);
    setWasCopied(true);
    wait(1200).then(() => setWasCopied(false));
  };

  const el =
    value?.length > 280 ? (
      <textarea disabled={true} className="subtitle" value={value || ""} />
    ) : (
      <input
        type="text"
        disabled={true}
        className="subtitle"
        value={value || ""}
      />
    );

  return (
    <div className={disableClasses ? "" : "active"}>
      <button className="secondary" onClick={() => copyAndReset(value)}>
        {wasCopied ? "Copied!" : "Copy"}
      </button>
      <div>
        <span className="title">{label}</span>
        {el}
      </div>
    </div>
  );
};
