import { execFileSync } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";

const entropy = "cat-studio-apimart-v1";

function powershell(script: string, input: string) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true
  }).trim();
}

export function encryptSecret(plain: string) {
  if (!plain) return "";
  if (process.platform === "win32") {
    const script = `Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$e=[Text.Encoding]::UTF8.GetBytes('${entropy}');$p=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($p)`;
    return `dpapi:${powershell(script, plain)}`;
  }
  const key = crypto.createHash("sha256").update(`${os.hostname()}:${entropy}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `aes:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptSecret(value: string) {
  if (!value) return "";
  if (value.startsWith("dpapi:")) {
    const script = `Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$e=[Text.Encoding]::UTF8.GetBytes('${entropy}');$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($p)`;
    return powershell(script, value.slice(6));
  }
  if (value.startsWith("aes:")) {
    const raw = Buffer.from(value.slice(4), "base64");
    const key = crypto.createHash("sha256").update(`${os.hostname()}:${entropy}`).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
  throw new Error("无法识别的密钥格式。请重新保存 API Key。");
}
