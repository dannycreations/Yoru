export function isValidTag(tag: string) {
	return /^#[0289CGJLPQRUVY]+$/i.test(tag)
}
