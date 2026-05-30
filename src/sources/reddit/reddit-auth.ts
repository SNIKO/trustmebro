import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import path from "node:path";

import { z } from "zod";

import { createLogger } from "../../utils/logger.js";

const log = createLogger("reddit");

const REDDIT_AUTH_BASE = "https://www.reddit.com";
const REDDIT_TOKEN_URL = `${REDDIT_AUTH_BASE}/api/v1/access_token`;
const REDDIT_CALLBACK_PORT = 53682;
const REDDIT_CALLBACK_PATH = "/reddit/callback";
const REDDIT_REDIRECT_URI = `http://localhost:${REDDIT_CALLBACK_PORT}${REDDIT_CALLBACK_PATH}`;
const TOKEN_FILE = "reddit-oauth.json";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const REDDIT_AUTH_TIMEOUT_MS = 2 * 60 * 1000;

const redditTokenResponseSchema = z.object({
	access_token: z.string(),
	expires_in: z.number(),
	refresh_token: z.string().optional(),
	scope: z.string().optional(),
	token_type: z.string().optional(),
});

const savedTokenSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresAt: z.number(),
	scope: z.string().optional(),
	tokenType: z.string().optional(),
});

type RedditTokenResponse = z.infer<typeof redditTokenResponseSchema>;
type SavedRedditToken = z.infer<typeof savedTokenSchema>;
type AuthorizationCallback = {
	expectedState: string;
	resolve(code: string): void;
	reject(error: unknown): void;
};

export type RedditTokenProvider = {
	getAccessToken(forceRefresh?: boolean): Promise<string>;
	getUserAgent(): string;
};

export function createRedditTokenProvider(workspacePath: string): RedditTokenProvider {
	return {
		getAccessToken(forceRefresh = false): Promise<string> {
			return getAccessToken(workspacePath, forceRefresh);
		},
		getUserAgent(): string {
			return buildUserAgent();
		},
	};
}

export async function authenticateReddit(workspacePath: string): Promise<boolean> {
	try {
		const existing = await loadSavedToken(workspacePath);
		if (existing) {
			try {
				await refreshAccessToken(workspacePath, existing);
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.warn(`Saved Reddit token could not be refreshed: ${message}`);
			}
		}

		await runBrowserLogin(workspacePath);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Reddit authentication failed: ${message}`);
		return false;
	}
}

async function getAccessToken(workspacePath: string, forceRefresh: boolean): Promise<string> {
	const token = await loadSavedToken(workspacePath);
	if (!token) throw new Error("Reddit is not authenticated. Run `trustmebro auth --source reddit` first.");

	const shouldRefresh = forceRefresh || token.expiresAt - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
	if (!shouldRefresh) return token.accessToken;

	const refreshed = await refreshAccessToken(workspacePath, token);
	return refreshed.accessToken;
}

async function runBrowserLogin(workspacePath: string): Promise<void> {
	const credentials = resolveClientCredentials();
	const state = randomBytes(24).toString("hex");
	const authUrl = buildAuthorizationUrl(credentials.clientId, state);
	const code = await waitForAuthorizationCode(state, authUrl);
	const response = await requestToken(credentials, {
		grant_type: "authorization_code",
		code,
		redirect_uri: REDDIT_REDIRECT_URI,
	});

	if (!response.refresh_token) {
		throw new Error("Reddit did not return a refresh token. Confirm the authorization URL uses duration=permanent.");
	}

	await saveToken(workspacePath, toSavedToken(response, response.refresh_token));
}

async function refreshAccessToken(workspacePath: string, savedToken: SavedRedditToken): Promise<SavedRedditToken> {
	const credentials = resolveClientCredentials();
	const response = await requestToken(credentials, {
		grant_type: "refresh_token",
		refresh_token: savedToken.refreshToken,
	});
	const nextToken = toSavedToken(response, response.refresh_token ?? savedToken.refreshToken);
	await saveToken(workspacePath, nextToken);
	return nextToken;
}

async function waitForAuthorizationCode(expectedState: string, authUrl: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			handleAuthorizationCallback(req, res, { expectedState, resolve: complete, reject: fail });
		});

		const timeout = setTimeout(() => {
			fail(new Error("Timed out waiting for Reddit OAuth callback after 2 minutes."));
		}, REDDIT_AUTH_TIMEOUT_MS);

		function complete(code: string): void {
			clearTimeout(timeout);
			server.close();
			resolve(code);
		}

		function fail(error: unknown): void {
			clearTimeout(timeout);
			server.close();
			reject(error);
		}

		server.on("error", fail);
		server.listen(REDDIT_CALLBACK_PORT, "localhost", () => {
			log.info(`Open this Reddit authorization URL: ${authUrl}`);
			openBrowser(authUrl);
		});
	});
}

function handleAuthorizationCallback(req: IncomingMessage, res: ServerResponse, callback: AuthorizationCallback): void {
	try {
		const code = readAuthorizationCode(req.url ?? "/", callback.expectedState);
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("Reddit authentication complete. You can close this tab.");
		callback.resolve(code);
	} catch (error) {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end(error instanceof Error ? error.message : String(error));
		callback.reject(error);
	}
}

function readAuthorizationCode(requestPath: string, expectedState: string): string {
	const requestUrl = new URL(requestPath, REDDIT_REDIRECT_URI);
	if (requestUrl.pathname !== REDDIT_CALLBACK_PATH) throw new Error("Unexpected Reddit callback path.");

	const error = requestUrl.searchParams.get("error");
	const code = requestUrl.searchParams.get("code");
	const state = requestUrl.searchParams.get("state");

	if (error) throw new Error(`Reddit returned OAuth error: ${error}`);
	if (!code) throw new Error("Reddit callback did not include an authorization code.");
	if (state !== expectedState) throw new Error("Reddit OAuth state did not match.");
	return code;
}

async function requestToken(
	credentials: RedditClientCredentials,
	body: Record<string, string>,
): Promise<RedditTokenResponse> {
	const response = await fetch(REDDIT_TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: `Basic ${buildBasicAuth(credentials)}`,
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": buildUserAgent(),
		},
		body: new URLSearchParams(body),
	});

	if (!response.ok) {
		throw new Error(`Reddit token request failed: ${response.status} ${await response.text()}`);
	}

	return redditTokenResponseSchema.parse(await response.json());
}

function buildAuthorizationUrl(clientId: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		duration: "permanent",
		redirect_uri: REDDIT_REDIRECT_URI,
		response_type: "code",
		scope: "read",
		state,
	});

	return `${REDDIT_AUTH_BASE}/api/v1/authorize?${params}`;
}

function toSavedToken(response: RedditTokenResponse, refreshToken: string): SavedRedditToken {
	return {
		accessToken: response.access_token,
		refreshToken,
		expiresAt: Date.now() + response.expires_in * 1000,
		scope: response.scope,
		tokenType: response.token_type,
	};
}

async function loadSavedToken(workspacePath: string): Promise<SavedRedditToken | null> {
	const filePath = tokenFilePath(workspacePath);
	if (!existsSync(filePath)) return null;

	const raw = await readFile(filePath, "utf8");
	return savedTokenSchema.parse(JSON.parse(raw));
}

async function saveToken(workspacePath: string, token: SavedRedditToken): Promise<void> {
	const dir = path.dirname(tokenFilePath(workspacePath));
	await mkdir(dir, { recursive: true });
	await writeFile(tokenFilePath(workspacePath), `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
	await chmod(tokenFilePath(workspacePath), 0o600);
}

function tokenFilePath(workspacePath: string): string {
	return path.join(workspacePath, ".trustmebro", TOKEN_FILE);
}

type RedditClientCredentials = {
	clientId: string;
	clientSecret: string;
};

function resolveClientCredentials(): RedditClientCredentials {
	const clientId = process.env.REDDIT_CLIENT_ID;
	const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? "";
	if (!clientId) throw new Error("REDDIT_CLIENT_ID is required for Reddit OAuth.");
	return { clientId, clientSecret };
}

function buildBasicAuth(credentials: RedditClientCredentials): string {
	return Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
}

function buildUserAgent(): string {
	const username = process.env.REDDIT_USER_AGENT_USERNAME ?? "unknown";
	return `node:trustmebro:v1.0.0 (by /u/${username})`;
}

function openBrowser(url: string): void {
	const command = getOpenBrowserCommand();
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", () => {
		log.debug("Could not open a browser automatically for Reddit authentication.");
	});
	child.unref();
}

function getOpenBrowserCommand(): string {
	if (process.platform === "darwin") return "open";
	if (process.platform === "win32") return "cmd";
	return "xdg-open";
}
