import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// 🔑 Put your values here
const apiId = 26998487; // <-- from my.telegram.org
const apiHash = "7c2ea1a5ee1d49df02458bb470d54ee1";
const stringSession = new StringSession(
	"1BQANOTEuMTA4LjU2LjE0MQG7VEdyNj6DtePYKR4k/WMW/JiSuE/mB4yY/nNeNw7mi0vHE1i5pgNANE7IOlNzT5T4EHEEkzi4Jl63hzzYmfvnusxlYCnDmnJxrltAZ/a5I1Wub3kcNgl1yo2vhInWNu9YJQwkrvQzZTUeXqfnwnikU+6+rp+MFnTghuGbBg0wVH8rx4WKpxa0XnDVAAuWjP3CdjlRMovsGMFGp+NVsqGAwRGHImfFaqdDcw/eOuMLWqnQFJKW+QhSIAq0T9Hn5NSXrEOIkFVta/VwARk9P627ZEIJN7CIpf4kdmPqRXDl1jgJgFuI5DfEWyei+hZy9o+0CCz8gz7VRTdKjfU5VQnylQ==",
);
const phoneNumber = "+61466115828"; // <-- including country code, e.g. +1 for US

(async () => {
	const client = new TelegramClient(stringSession, apiId, apiHash, {
		connectionRetries: 5,
	});

	// 🔐 Login flow
	await client.start({
		phoneNumber: async () => phoneNumber,
		password: async () =>
			await input.text("Enter your 2FA password (if any): "),
		phoneCode: async () => await input.text("Enter the code you received: "),
		onError: (err) => console.log(err),
	});

	console.log("✅ Logged in!");

	// 💾 Save session (IMPORTANT)
	const session = client.session.save();
	console.log("Your session string:");
	console.log(session);

	// 🔎 Fetch public channel
	const channel = await client.getEntity("trend_gen"); // try any public channel username

	// 📥 Fetch messages
	const messages = await client.getMessages(channel, {
		limit: 20,
	});

	console.log(`\nLast ${messages.length} messages:\n`);

	for (const msg of messages) {
		console.log(`[${msg.date}] ${msg.message}`);
	}
})();
