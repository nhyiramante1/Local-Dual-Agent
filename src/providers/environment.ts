const allowedEnvironmentNames = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

export function sanitizedAgentEnvironment(
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (allowedEnvironmentNames.has(name.toUpperCase()) && value !== undefined) {
      env[name] = value;
    }
  }
  for (const [name, value] of Object.entries(extra)) {
    for (const existing of Object.keys(env)) {
      if (existing.toUpperCase() === name.toUpperCase()) delete env[existing];
    }
    env[name] = value;
  }
  return env;
}
