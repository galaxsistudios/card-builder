// Runtime checks for values arriving over IPC - TypeScript's types don't exist at runtime, so a
// compromised or buggy renderer could otherwise send anything to the main process's handlers.
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 200;

export function requireString(
	value: unknown,
	label: string,
	maxLength = MAX_STRING_LENGTH,
): string {
	if (typeof value !== "string" || value.length > maxLength) {
		throw new Error(`${label} must be a string of at most ${maxLength} characters.`);
	}

	return value;
}

export function requireInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`${label} must be an integer.`);
	}

	return value;
}

export function optionalInt(value: unknown, label: string): number | undefined {
	return value === undefined || value === null ? undefined : requireInt(value, label);
}

export function optionalString(value: unknown, label: string): string | undefined {
	return value === undefined || value === null ? undefined : requireString(value, label);
}

export function optionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH) {
		throw new Error(`${label} must be an array of at most ${MAX_ARRAY_LENGTH} strings.`);
	}

	return value.map((item, i) => requireString(item, `${label}[${i}]`));
}

export function requireIntArray(value: unknown, label: string): number[] {
	if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH) {
		throw new Error(`${label} must be an array of at most ${MAX_ARRAY_LENGTH} integers.`);
	}

	return value.map((item, i) => requireInt(item, `${label}[${i}]`));
}

export function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}

	return value as Record<string, unknown>;
}
