const write = (level, message, meta) => {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const target = level === "error" || level === "warn" ? console.error : console.log;
  if (meta === undefined) target(line);
  else target(line, typeof meta === "string" ? meta : JSON.stringify(meta));
};

export const logger = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
