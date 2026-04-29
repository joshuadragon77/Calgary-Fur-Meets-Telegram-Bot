/**
 * Jade's Telegram Bot Furmeet Pinner
 * 
 * Instructions for admins.
 * 
 * Replace bot_api_key with your own.
 * 
 * Use /authorize_pin within the group chat to authorize specific users to pin.
 * Use /set_main_group_chat on the main group chat to identify the main group chat for the bot
 * Use /set_broadcast_channel on the main group chat to start the identification of the broadcast channel for the bot
 *      After running this command. Type any message within the broadcast channel that the bot is in to identify it.
 * Any authorized users can now use /pin within PM to pin any meets!
 * 
 * Let @joshuadagon77 on telegram know of any problem.
 */

process.env.TZ = "America/Edmonton";

import { AttachmentBuilder, AutoModerationRuleTriggerType, ChatInputCommandInteraction, Client, Collection, Embed, EmbedBuilder, GatewayIntentBits, InviteStageInstance, MessageFlags, REST, Routes, SlashCommandBuilder, SlashCommandStringOption, type RESTPostAPIChatInputApplicationCommandsJSONBody, type SlashCommandOptionsOnlyBuilder } from "discord.js";
import { Bot, Context, type CommandContext } from "grammy";
import { LowLevelJadeDB } from "./modules/jadestores.js";
import { JadeStruct } from "./modules/jadestruct.js";
import * as console from "./modules/consolescript.js";
import { get } from "https";
import { readFileSync } from "fs";
import { TelegramHandler } from "./modules/clients/telegram_menu.js";
import { MeetManager } from "./modules/utils/meet_manager.js";
import { DiscordHandler } from "./modules/clients/discord_menu.js";

const configs = JSON.parse(readFileSync("./env.json", "ascii")) as {
    "telegram_bot_token": string,
    "discord_bot_token": string,
    "discord_client_id": string
};

const telegram_bot_api_key = configs.telegram_bot_token;
const discord_bot_api_key = configs.discord_bot_token;
const client_id = configs.discord_client_id;

(async ()=>{
    let meet_manager = new MeetManager();

    await meet_manager.start();
    
    let telegram_handler = new TelegramHandler(telegram_bot_api_key, meet_manager)
    await telegram_handler.attempt_sign_in();

    let discord_handler = new DiscordHandler(discord_bot_api_key, client_id, meet_manager);
    await discord_handler.attempt_sign_in();

    
})();
