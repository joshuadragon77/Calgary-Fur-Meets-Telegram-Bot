import * as console from "../consolescript.js";
import { Bot, Context, InlineKeyboard } from "grammy";
import { Menu } from "@grammyjs/menu";
import type { Message } from "grammy/types";
import { CommandGroup } from "@grammyjs/commands";
import { get } from "https";

type TelegramUserStateMachine = {
    initialized_message: Message
}

type TelegramUser = {
    user_id: number;
    username: string;
}

type Meet = {
    planned_date: Date,
    planner: string,
    pinner: string,
    message_id: number,
    chat_id: number,
    meet_name: string,
    meet_info: string,
    meet_disabled: boolean,
    attached_meet_media: Buffer | undefined
}

type FurmeetCreation_UserStates = "MainMenu" | "MeetName" | "MeetLocation" | "MeetDate" | "MeetPlanner" | "MeetDescription" | "MeetMedia";

type FurmeetCreation_UserStateMachine = {
    state: FurmeetCreation_UserStates,
    meet_name: string,
    meet_location: {
        name: string,
        address: string,
        location: {
            latitude: number,
            longitude: number
        }
        valid: boolean
    }
    meet_date: {
        month: number,
        date: number,
        year: number,
        hour: number,
        minute: number,
        parsed_date: Date
    }
    force_reply_request: Message | undefined
}

class FurmeetCreation_GenMenu{

    private main_menu: Menu;

    private telegram_bot: Bot;
    private user_state_machines = new Map<string, FurmeetCreation_UserStateMachine>();

    constructor(telegram_bot: Bot){
        this.telegram_bot = telegram_bot;
        
        let main_menu = this.main_menu = new Menu("furmeet_creation_root")
            .submenu("🏷️ Set Meet Name", "furmeet_creation_set_meet_name", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetName");
            })
            .submenu("🗺️ Set Location", "furmeet_creation_set_location", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetLocation");
            })
            .row()
            .submenu("📅 Set Meet Date", "furmeet_creation_set_date", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetDate");
            })
            .submenu("📱 Set Contact Info", "furmeet_creation_set_planner_contacts", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetPlanner");
            })
            .row()
            .submenu("🗒️ Set Description", "furmeet_creation_set_meet_description", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetDescription");
            })
            .submenu("🖼️ Attach Media", "furmeet_creation_set_meet_media", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetMedia");
            })
            .row()
            .text("❌ Cancel")
            .text("✅ Submit")

        let set_meet_name_menu = new Menu("furmeet_creation_set_meet_name")
            .text("📝 Edit Meet Name", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");
                let user_state_machine = this.obtain_user_state_machine(context)!;

                await this.send_status_message(context, "Enter the new Meet Name", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let set_meet_location_menu = new Menu("furmeet_creation_set_location")
            .text("📝 Edit Location", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");
            })
            .text("🌎 See Location", async (context)=>{
                let user_state_machine = this.obtain_user_state_machine(context)!;

                if (user_state_machine.meet_location.valid){
                    let location = user_state_machine.meet_location;
                    await this.send_status_message(context, `${location.name} located @ ${location.address}`, false);

                    await this.telegram_bot.api.sendLocation(context.chat!.id, location.location.latitude, location.location.longitude);
                }else{
                    await this.send_status_message(context, "Location is not specified", false);
                }
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })

        let set_meet_date = new Menu("furmeet_creation_set_date")
            .submenu("📝 Edit Month", "furmeet_creation_set_date_month")
            .submenu("📝 Edit Date", "furmeet_creation_set_date_day")
            .row()
            .submenu("📝 Edit Time", "furmeet_creation_set_date_time")
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })

        let months = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December"
        ];

        let set_meet_date_month = new Menu("furmeet_creation_set_date_month");

        for (let month of months){
            set_meet_date_month.back(month, async (context)=>{});
            set_meet_date_month.row();
        }
        set_meet_date_month.back("❌ Cancel", async (context)=>{
        });

        let set_meet_date_day = new Menu("furmeet_creation_set_date_day");

        for (let i = 0;i<31;i++){
            
            if (i != 0 && i % 7 == 0){
                set_meet_date_day.row();
            }
            set_meet_date_day.back(`${i + 1}`, async (context)=>{});
        }
        set_meet_date_day.back("❌ Cancel", async (context)=>{
        });

        let set_meet_date_time = new Menu("furmeet_creation_set_date_time");

        for (let i = 0;i<24;i++){
            
            if (i != 0 && i % 3 == 0){
                set_meet_date_time.row();
            }

            let hour = i;
            let designator = "AM";

            if (hour >= 12){
                hour -= 12;
                designator = "PM";
            }

            if (i == 0){
                hour = 12;
            }

            set_meet_date_time.back(`${hour} ${designator}`, async (context)=>{});
        }
        set_meet_date_time.back("❌ Cancel", async (context)=>{
        });

        let set_planner_contacts = new Menu("furmeet_creation_set_planner_contacts")
            .submenu("📨 Specify Telegram Contact", "furmeet_creation_set_planner_contact_telegram")
            .row()
            .submenu("🎮 Specify Discord Contact", "furmeet_creation_set_planner_contact_discord")
            .row()
            .back("🔙 Back", async (context)=>{
            });

        let set_meet_description = new Menu("furmeet_creation_set_meet_description")
            .text("📝 Edit Meet Description", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.obtain_user_state_machine(context)!;

                await this.send_status_message(context, "Enter the new Meet Description", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
            
        let set_meet_media = new Menu("furmeet_creation_set_meet_media")
            .text("📝 Edit Meet Media", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the media");
                let user_state_machine = this.obtain_user_state_machine(context)!;

                await this.send_status_message(context, "Enter the new Meet Media", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        main_menu.register(set_meet_name_menu);
        main_menu.register(set_meet_location_menu);
        main_menu.register(set_meet_date);
        set_meet_date.register(set_meet_date_month);
        set_meet_date.register(set_meet_date_day);
        set_meet_date.register(set_meet_date_time);
        main_menu.register(set_planner_contacts);
        main_menu.register(set_meet_description);
        main_menu.register(set_meet_media);

        telegram_bot.use(main_menu);
    }

    obtain_menu_identifier(context: Context){
        if (
            !context.from ||
            !context.update.callback_query ||
            !context.update.callback_query.message ||
            !context.chat
        )
            return null;

        return `${this.obtain_user_chat_identifier(context)}/${context.chat.id}`
    }

    obtain_user_chat_identifier(context: Context){
        if (
            !context.from ||
            !context.chat
        )
            return null;

        return `/${context.chat.id}/${context.from.id}`
    }

    obtain_user_state_machine(context: Context){

        let menu_identifier = this.obtain_menu_identifier(context);
        let user_chat_identifier = this.obtain_user_chat_identifier(context);

        let user_state_machine: FurmeetCreation_UserStateMachine | undefined;
        
        if (!menu_identifier && !user_chat_identifier){
            return null;
        }

        if (menu_identifier)
            user_state_machine = this.user_state_machines.get(menu_identifier);

        if (user_chat_identifier)
            user_state_machine = this.user_state_machines.get(user_chat_identifier);

        return user_state_machine;
    }

    async state_machine_operation(context: Context, new_state: FurmeetCreation_UserStates){

        let user_state_machine = this.obtain_user_state_machine(context);

        if (!user_state_machine)
            return;

        user_state_machine.state = new_state;

        switch (user_state_machine.state){
            case "MainMenu":{
                break;
            }
            case "MeetName":{
                break
            }
        }
    }

    state_machine_get_message(context: Context){
        let user_state_machine = this.obtain_user_state_machine(context);

        if (!user_state_machine)
            return "";

        switch (user_state_machine.state){
            case "MainMenu":{
                return `You are creating a meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>February 19th 2026 12:00:00 PM</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>TheJades</u>\n` +
                    `<i>We are going to a special place in the forest. :)\nWhere no one can find us.</i>\n` +
                    ``;
            }
            case "MeetName":{
                return `You are changing the <b>Meet Name</b>.\n\n` + 
                    `It was <u>${user_state_machine.meet_name}</u> previously.\n` +
                    `To change it, specify a new name in the chat or press the <b>Edit Meet Name</b> button.`;
            }
            case "MeetLocation":{
                return `You are changing the <b>Meet Location</b>.\n\n` + 
                    `It was <u>${user_state_machine.meet_name}</u> previously.\n` +
                    `To change it, specify a Google Maps Link to that location using the share button..`;
            }
            case "MeetDate":{
                return `You are changing the <b>Meet Date</b>.\n\n` + 
                    `It was <u>${"asd"}</u> previously.\n` +
                    `To change it, click on the following buttons to begin or...` +
                    `Write me a time or date and I can try my best to understand!`;
            }
            case "MeetPlanner":{
                return `You are changing the <b>Planner's Contact Information</b>.\n\n` + 
                    `It was <u>${"asd"}</u> previously.\n` +
                    `To change it, click on the following buttons to begin or...`;
            }
            case "MeetDescription":{
                return `You are changing the <b>Meet Description</b>.\n\n` + 
                    `It was <u>${"asd"}</u> previously.\n` +
                    `To change it, specify a new description in the chat or press the <b>Edit Meet Description</b> button.`;
            }
            case "MeetMedia":{
                return `You are changing the <b>Meet Media</b>.\n\n` + 
                    `It was <u>${"asd"}</u> previously.\n` +
                    `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
            }
        }
    }

    async menu_interaction_state_machine(context: Context, new_state: FurmeetCreation_UserStates){
        
        let user_state_machine = this.obtain_user_state_machine(context);
        
        if (!user_state_machine)
            return;

        await this.state_machine_operation(context, new_state);
        context.editMessageText(this.state_machine_get_message(context), {
            parse_mode: "HTML"
        });
        await this.clear_status_message(context);
    }

    async generate_menu(context: Context){

        let user_chat_identifier = this.obtain_user_chat_identifier(context);

        if (!user_chat_identifier){
            return null;
        }

        let new_user_state_machine: FurmeetCreation_UserStateMachine = {
            state: "MainMenu",
            meet_name: "Generic Furmeet",
            force_reply_request: undefined,
            meet_location: {
                name: "Unknown Location",
                address: "",
                location: {
                    latitude: 0,
                    longitude: 0
                },
                valid: false
            },
            meet_date: {
                month: 0,
                date: 1,
                year: 2026,
                hour: 6,
                minute: 21,
                parsed_date: new Date()
            }
        };


        this.user_state_machines.set(user_chat_identifier, new_user_state_machine);

        let initial_message = this.state_machine_get_message(context);

        let message = await context.reply(initial_message, {
            parse_mode: "HTML",
            reply_markup: this.main_menu
        });

        let menu_identifier = `${user_chat_identifier}/${message.message_id}`;

        this.user_state_machines.set(menu_identifier, new_user_state_machine);
    }

    async send_status_message(context: Context, text: string, force_reply: boolean = false){
        let user_state_machine = this.obtain_user_state_machine(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.clear_status_message(context);
        }

        // telegram u stopid
        
        if (force_reply){
            user_state_machine.force_reply_request = await context.reply(text, {
                reply_markup: {
                    force_reply: true
                },
                parse_mode: "HTML"
            });
        }else{
            user_state_machine.force_reply_request = await context.reply(text, {
                parse_mode: "HTML"
            });
        }
    }

    async clear_status_message(context: Context){
        let user_state_machine = this.obtain_user_state_machine(context);

        if (!user_state_machine)
            return;

        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.telegram_bot.api.deleteMessage(force_reply_request.chat.id, force_reply_request.message_id);

            user_state_machine.force_reply_request = undefined;
        }
    }

    async on_general_message_event(context: Context){

        let user_state_machine = this.obtain_user_state_machine(context);

        if (!user_state_machine)
            return;

        switch(user_state_machine.state){
            case "MeetName":{
                
                let user_message = context.message!;
                let new_meet_name = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.send_status_message(context, `You have set the name of this meet to <b>${new_meet_name}</b>`);

                user_state_machine.meet_name = new_meet_name;

                break;
            }
            case "MeetLocation":{
                console.log(context);
                
                let user_message = context.message!;
                let meet_location = user_message.text!;
                
                let venue_location = user_message.venue;

                let location_name = user_message.text || "Unknown Location";

                if (venue_location){
                    location_name = venue_location.title;
                    await this.send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>\n`);
                    
                    user_state_machine.meet_location.location = venue_location.location;
                    user_state_machine.meet_location.address = venue_location.address;
                }else{
                    await this.send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>.\n` +
                        `This location cannot be looked up from its name and therefore map context features cannot be used. Please use the location picker and try again.`
                    );
                }

                user_state_machine.meet_location.valid = true;
                user_state_machine.meet_location.name = location_name;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);

                break;
            }
        }
    }

    async on_foward_message_event(context: Context){
        
    }
}

export class TelegramHandler{

    private telegram_bot;
    private telegram_bot_token: string;

    public constructor(telegram_bot_token: string){
        this.telegram_bot = new Bot(telegram_bot_token);
        this.telegram_bot_token = telegram_bot_token;

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

    private get_command_match(context: Context): {command: string, rest: string} | undefined{
        return (context as any).commandMatch;
    }

    private async initialize_client(){
        // FurmeetCreator_Menus.initialize(this.telegram_bot, this.telegram_bot_token);

        let commands = new CommandGroup();

        const main = new Menu("root-menu")
            .text("Welcome", (ctx) => ctx.editMessageText("Hi!")).row()
            .submenu("Credits", "credits-menu");

        const settings = new Menu("credits-menu")
            .text("Show Credits", (ctx) => ctx.editMessageText("Powered by grammY"))
            .back("Go Back");
        // Register settings menu at main menu.
        main.register(settings);
        this.telegram_bot.use(main);

        let gen = new FurmeetCreation_GenMenu(this.telegram_bot);

        commands.command("start", "Start Command", async (context)=>{
            let command_match = this.get_command_match(context);

            gen.generate_menu(context);
        });

        this.telegram_bot.on("message:forward_origin", (context: Context)=>{
            if (!context.update.message || !context.update.message.forward_origin)
                return;

            gen.on_foward_message_event(context);
        });

        this.telegram_bot.on("message", (context: Context, next)=>{
            if (!context.update.message || context.update.message.forward_origin)
                return;

            gen.on_general_message_event(context);

            next();
        });
        

        this.telegram_bot.use(commands);
        await commands.setCommands(this.telegram_bot);
    }
}