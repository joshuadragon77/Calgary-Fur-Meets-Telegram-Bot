import * as console from "../consolescript.js";
import { Bot, Context } from "grammy";
import { Menu } from "@grammyjs/menu";
import type { Message } from "grammy/types";

type TelegramUserStateMachine = {
    initialized_message: Message
}

type TelegramUser = {
    user_id: number;
    username: string;
}

export class TelegramHandler{

    private internal_user_statemachine = new Map();

    private telegram_bot;

    public constructor(telegram_bot_token: string){
        this.telegram_bot = new Bot(telegram_bot_token);

        this.telegram_bot.catch((error)=>{
            console.error(`Telegram Bot has experienced a fault: ${error.message}`);
            console.warn(`The fault is located at ${error.stack}`);
        });
    }

    public async attempt_sign_in(){
        console.log("Logging into Telegram Bot...");
        await this.initialize_client();

        this.telegram_bot.start();
    
        console.log("Logged into Telegram Bot!");
    }

    private async initialize_client(){

        await this.telegram_bot.api.setMyCommands([
            {command: "test", description: "test"},
        ]);

        let message: Message;


        let menu = new Menu("initial-menu")
            .text("A", (context)=>{
                this.telegram_bot.api.editMessageText(message.chat.id, message.message_id, "A");
            })
            .text("B", (context)=>{
                this.telegram_bot.api.editMessageText(message.chat.id, message.message_id, "B", {
                    reply_markup: menu
                });
            });

        this.telegram_bot.use(menu);

        await this.telegram_bot.command("test", async (context)=>{
            message = await context.reply("Check me out!", {
                reply_markup: menu
            });
        });
    }
}