declare module "input" {
	function text(message: string): Promise<string>;
	function password(message: string): Promise<string>;
	function confirm(message: string): Promise<boolean>;
	function select(message: string, choices: string[]): Promise<string>;
	function checkboxes(message: string, choices: string[]): Promise<string[]>;
}
