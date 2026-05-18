import React, { useState } from "react";
import { styles } from "../styles/appStyles";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ style, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <input
        {...props}
        type={visible ? "text" : "password"}
        style={{ ...styles.input, paddingRight: 44, ...style }}
      />
      <button
        type="button"
        className="password-input-toggle"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.5 4.7A9.5 9.5 0 0 1 12 4c5.4 0 9 5.5 9 5.5a17.9 17.9 0 0 1-3.1 3.8" />
            <path d="M6.1 6.1A17.6 17.6 0 0 0 3 9.5S6.6 15 12 15a9.8 9.8 0 0 0 2.7-.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 12s3.6-5.5 9-5.5 9 5.5 9 5.5-3.6 5.5-9 5.5S3 12 3 12Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        )}
      </button>
    </div>
  );
}
