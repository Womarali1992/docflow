/** Mirrors the server policy (server/src/auth/passwords.ts): at least 12 characters. */
export const PASSWORD_MIN = 12;

export const passwordsReady = (password: string, confirm: string) => password.length >= PASSWORD_MIN && password === confirm;
