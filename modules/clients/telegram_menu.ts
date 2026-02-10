import * as console from "../consolescript.js";
import { Bot, Context, InlineKeyboard, InputFile, InputMediaBuilder, type CallbackQueryContext } from "grammy";
import { Menu } from "@grammyjs/menu";
import type { Message } from "grammy/types";
import { CommandGroup } from "@grammyjs/commands";
import type { File, Update } from "@grammyjs/types";
import { get } from "https";
import { MeetManager, type ChatConfiguration, type DiscordUser, type Meet, type MeetAttendee, type TelegramUser } from "../utils/meet_manager.js";
import { format_date } from "../utils/units.js";
import { createHash } from "crypto";

type TelegramUserStateMachine = {
    initialized_message: Message
}


type FurmeetCreation_UserStates = "IntroMenu" | "MainMenu" | "MeetName" | "MeetLocation" | "MeetDate" | "MeetPlanner" | "MeetDescription" | "MeetMedia" | "Cancelled" | "LastConfirm" | "Confirmed";
type FurmeetManager_UserStates = "IntroMenu" | "MainMenu" | "MeetName" | "MeetLocation" | "MeetDate" | "MeetPlanner" | "MeetDescription" | "MeetMedia" | "Cancelled" | "LastConfirm" | "Confirmed" | "LastDelete" | "Deleted";

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
    meet_date: Date,
    meet_description: string,
    meet_media: Buffer | undefined,
    planner_contact: {
        discord_username: string | undefined,
        telegram_username: string | undefined,
        enter_field_mode: "Discord" | "Telegram"
    }
    force_reply_request: Message | undefined
    last_menu_context: Context | undefined;
}

type FurmeetManager_UserStateMachine = {
    state: FurmeetManager_UserStates,
    linked_meet: Meet,
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
    meet_date: Date,
    meet_description: string,
    meet_media: Buffer | undefined,
    planner_contact: {
        discord_username: string | undefined,
        telegram_username: string | undefined,
        enter_field_mode: "Discord" | "Telegram"
    }
    force_reply_request: Message | undefined
    last_menu_context: Context | undefined;
}

type ChatConfigurator_UserStates = "IntroMenu" | "MainMenu" | "AnnouncementConfiguration" | "PinConfiguration" | "Cancelled";

type ChatConfigurator_UserStateMachine = {
    state: ChatConfigurator_UserStates,
    chat_configuration: ChatConfiguration
    force_reply_request: Message | undefined
    last_menu_context: Context | undefined;

    callback_channel_link: ((channel_id: number)=>(void)) | undefined
}

class ChatConfigurator_Menu{
    private main_menu: Menu;
    private intro_menu: Menu;

    private telegram_bot: Bot;
    private telegram_handler: TelegramHandler;
    private meet_manager: MeetManager;
    private user_state_machines = new Map<string, ChatConfigurator_UserStateMachine>();
    private channel_lookup_link: ChatConfigurator_UserStateMachine | undefined = undefined;

    constructor(telegram_bot: Bot, telegram_handler: TelegramHandler, meet_manager: MeetManager){
        this.telegram_handler = telegram_handler;
        this.telegram_bot = telegram_bot;
        this.meet_manager = meet_manager;

        let intro_menu = this.intro_menu = new Menu("chat_configurator_initial")
            .submenu("Configure Chat...", "chat_configurator_root", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
        
        let main_menu = this.main_menu = new Menu("chat_configurator_root")
            .submenu("📢 Configure Announcement Channnel", "chat_configurator_announcement", async (context)=>{
                await this.menu_interaction_state_machine(context, "AnnouncementConfiguration");
            })
            .row()
            .submenu("📌 Configure Pin Preference", "chat_configurator_pin", async (context)=>{
                await this.menu_interaction_state_machine(context, "PinConfiguration");
            })
            .row()
            .submenu("❌ Close", "chat_configurator_cancelled", async (context)=>{
                await this.menu_interaction_state_machine(context, "Cancelled");
            });

        let chat_configurator_announcement_menu = new Menu("chat_configurator_announcement")
            .text((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                switch(chat_configuration.announcements.enabled){
                    case "Channel":{
                        return "⚙️ Broadcast to [Channel + Chat]";
                        break;
                    }
                    case "Chat":{
                        return "⚙️ Broadcast to [Chat]";
                        break;
                    }
                    case "Disabled":{
                        return "⚙️ Broadcast to [Disabled]";
                        break;
                    }
                }
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                switch(chat_configuration.announcements.enabled){
                    case "Channel":{
                        chat_configuration.announcements.enabled = "Chat";
                        break;
                    }
                    case "Chat":{
                        chat_configuration.announcements.enabled = "Disabled";
                        break;
                    }
                    case "Disabled":{
                        if (chat_configuration.announcements.binded_announcement_chat_id){
                            chat_configuration.announcements.enabled = "Channel";
                        }else{
                            chat_configuration.announcements.enabled = "Chat";
                        }
                        break;
                    }
                }

                await this.meet_manager.save_system_data();
                await context.menu.update();
            })
            .row()
            .text(async (context)=>{

                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;
                
                let binded_channel_chat_id = user_state_machine.chat_configuration.announcements.binded_announcement_chat_id;

                if (binded_channel_chat_id){

                    let binded_channel_chat = await this.telegram_bot.api.getChat(binded_channel_chat_id);

                    return `🔗 Unpair from ${binded_channel_chat.title}`;
                }else{
                    if (this.channel_lookup_link == user_state_machine){
                        return "🔗 Cancel Pairing Process";
                    }else{
                        return "🔗 Pair with announcement channel";
                    }
                }

            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;
                
                let binded_channel_chat_id = user_state_machine.chat_configuration.announcements.binded_announcement_chat_id;

                if (binded_channel_chat_id){
                    user_state_machine.chat_configuration.announcements.binded_announcement_chat_id = undefined;

                    await this.meet_manager.save_system_data();
                    await this.menu_send_status_message(context, "This chat has been unpaired from its channel!");
                }else
                    if (this.channel_lookup_link){
                        if (this.channel_lookup_link == user_state_machine){
                            this.channel_lookup_link = undefined;
                        }
                    }else{

                        user_state_machine.callback_channel_link = async (chat_id: number)=>{
                            this.channel_lookup_link = undefined;

                            user_state_machine.chat_configuration.announcements.binded_announcement_chat_id = chat_id;

                            await this.meet_manager.save_system_data();
                            await this.menu_send_status_message(context, "The pair process has succeeded!");
                            await this.menu_update_text(context);
                        };

                        this.channel_lookup_link = user_state_machine;
                    }

                await this.menu_update_text(context);
            })
            .row()
            .back("🔙 Return", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                if (this.channel_lookup_link == user_state_machine){
                    this.channel_lookup_link = undefined;
                    await this.menu_send_status_message(context, "The channel pairing process has been cancelled.");
                }
            });

        let chat_configurator_pin_menu = new Menu("chat_configurator_pin")
            .text((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                if (chat_configuration.pin_preference.enabled){
                    return "⚙️ Toggle Enable State [ON]"
                }else{
                    return "⚙️ Toggle Enable State [OFF]"
                }
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                chat_configuration.pin_preference.enabled = !chat_configuration.pin_preference.enabled;

                await this.meet_manager.save_system_data();
                await context.menu.update();
            })
            .row()
            .text((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                if (chat_configuration.pin_preference.unpin_after_expirey){
                    return "⚙️ Toggle Unpin after Expirey [ON]"
                }else{
                    return "⚙️ Toggle Unpin after Expirey [OFF]"
                }
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                chat_configuration.pin_preference.unpin_after_expirey = !chat_configuration.pin_preference.unpin_after_expirey;

                await this.meet_manager.save_system_data();
                await context.menu.update();
            })
            .row()
            .text((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                switch(chat_configuration.pin_preference.expirey_period){
                    case "1 day":{return "⏲️ Expirey Period [1 day]";};
                    case "2 day":{return "⏲️ Expirey Period [2 day]";};
                    case "4 day":{return "⏲️ Expirey Period [4 day]";};
                    case "8 day":{return "⏲️ Expirey Period [8 day]";};
                    case "16 day":{return "⏲️ Expirey Period [16 day]";};
                }
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                let chat_configuration = user_state_machine.chat_configuration!;

                switch(chat_configuration.pin_preference.expirey_period){
                    case "1 day":{chat_configuration.pin_preference.expirey_period = "2 day";break;};
                    case "2 day":{chat_configuration.pin_preference.expirey_period = "4 day";break;};
                    case "4 day":{chat_configuration.pin_preference.expirey_period = "8 day";break;};
                    case "8 day":{chat_configuration.pin_preference.expirey_period = "16 day";break;};
                    case "16 day":{chat_configuration.pin_preference.expirey_period = "1 day";break;};
                }

                await this.meet_manager.save_system_data();
                await context.menu.update();
            })
            .row()
            .back("🔙 Return");

        let chat_configurator_cancelled_menu = new Menu("chat_configurator_cancelled");

        intro_menu.register(main_menu);
        main_menu.register(chat_configurator_announcement_menu);
        main_menu.register(chat_configurator_pin_menu);
        main_menu.register(chat_configurator_cancelled_menu);

        this.telegram_bot.use(intro_menu);
    }

    state_machine_obtain_menu_identifier(context: Context){
        if (
            !context.from ||
            !context.update.callback_query ||
            !context.update.callback_query.message ||
            !context.chat
        )
            return null;

        return `${this.state_machine_obtain_user_chat_identifier(context)}/${context.chat.id}`
    }

    state_machine_obtain_user_chat_identifier(context: Context){
        if (
            !context.from ||
            !context.chat
        )
            return null;

        return `/${context.chat.id}/${context.from.id}`
    }

    state_machine_obtain_user_states(context: Context){

        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


        let user_state_machine: ChatConfigurator_UserStateMachine | undefined;
        
        if (!menu_identifier && !user_chat_identifier){
            return null;
        }

        if (menu_identifier)
            user_state_machine = this.user_state_machines.get(menu_identifier);

        if (user_chat_identifier)
            user_state_machine = this.user_state_machines.get(user_chat_identifier);

        return user_state_machine;
    }

    state_machine_clear_user_states(context: Context){
        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


        if (menu_identifier)
            this.user_state_machines.delete(menu_identifier);

        if (user_chat_identifier)
            this.user_state_machines.delete(user_chat_identifier);
    }

    async state_machine_operation(context: Context, new_state: ChatConfigurator_UserStates){

        
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        user_state_machine.state = new_state;

        switch (user_state_machine.state){
        }
    }

    state_machine_get_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return "";

        switch (user_state_machine.state){
            case "IntroMenu":{
                return `This command permits admin to modify the bot's behaviour when interacting with this chat.\n` +
                    `To get started, please press the <b>Configure Chat...</b> button!\n\n`;
            }
            case "MainMenu":{
                return `Welcome to Main Menu. Please select an option.\n\n`;
            }
            case "AnnouncementConfiguration":{
                return `Welcome to Announcement Configuration. You can change bot behaviour when it comes to announcing in this particular chat.\n\n`;
            }
            case "PinConfiguration":{
                return `Welcome to Pin Configuration. You can change bot behaviour when it comes to pinning in this particular chat.\n\n` + 
                    `<i>Note that this setting does not apply if the posts are broadcasted to the channel instead of the chat</i>`;
            }
            case "Cancelled":{
                return `This menu has been closed.\n\n`;
            }
        }
    }

    async menu_interaction_state_machine(context: Context, new_state: ChatConfigurator_UserStates){
        
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        await this.state_machine_operation(context, new_state);
        context.editMessageText(this.state_machine_get_message(context), {
            parse_mode: "HTML"
        });
        await this.menu_clear_status_message(context);
        user_state_machine.last_menu_context = context;
    }

    async menu_update_text(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        if (user_state_machine.last_menu_context){
            user_state_machine.last_menu_context.editMessageText(this.state_machine_get_message(context), {
                parse_mode: "HTML"
            });
        }

    }

    async menu_generate(context: Context, chat_configuration: ChatConfiguration){

        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);

        if (!user_chat_identifier){
            return null;
        }

        let new_user_state_machine: ChatConfigurator_UserStateMachine = {
            state: "IntroMenu",
            chat_configuration,
            force_reply_request: undefined,
            last_menu_context: undefined,
            callback_channel_link: undefined
        };


        this.user_state_machines.set(user_chat_identifier, new_user_state_machine);

        let initial_message = this.state_machine_get_message(context);

        let message = await context.reply(initial_message, {
            protect_content: true,
            parse_mode: "HTML",
            reply_markup: this.intro_menu,
        });

        let menu_identifier = `${user_chat_identifier}/${message.message_id}`;

        this.user_state_machines.set(menu_identifier, new_user_state_machine);
    }

    async menu_send_status_message(context: Context, text: string, force_reply: boolean = false){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.menu_clear_status_message(context);
        }

        // telegram u stopid
        
        if (force_reply){
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                reply_markup: {
                    force_reply: true
                },
                parse_mode: "HTML"
            });
        }else{
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                parse_mode: "HTML"
            });
        }
    }

    async menu_clear_status_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.telegram_bot.api.deleteMessage(force_reply_request.chat.id, force_reply_request.message_id);

            user_state_machine.force_reply_request = undefined;
        }
    }

    async on_general_message_event(context: Context){
        if (this.channel_lookup_link && context.channelPost){

            this.channel_lookup_link.callback_channel_link!(context.channelPost.chat.id);

            return;
        }

        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        switch(user_state_machine.state){
        }
    }
}

class FurmeetCreation_GenMenu{

    private main_menu: Menu;
    private intro_menu: Menu;

    private telegram_bot: Bot;
    private telegram_handler: TelegramHandler;
    private meet_manager: MeetManager;
    private user_state_machines = new Map<string, FurmeetCreation_UserStateMachine>();

    constructor(telegram_bot: Bot, telegram_handler: TelegramHandler, meet_manager: MeetManager){
        this.telegram_handler = telegram_handler;
        this.telegram_bot = telegram_bot;
        this.meet_manager = meet_manager;

        let intro_menu = this.intro_menu = new Menu("furmeet_creation_initial")
            .submenu("Create a furmeet!", "furmeet_creation_root", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
        
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
            .submenu("❌ Cancel", "furmeet_creation_cancelled", async (context)=>{
                await this.menu_interaction_state_machine(context, "Cancelled");
            })
            .submenu("✅ Submit", "furmeet_creation_last_confirm", async (context)=>{
                await this.menu_interaction_state_machine(context, "LastConfirm");
            })

        let set_meet_name_menu = new Menu("furmeet_creation_set_meet_name")
            .text("📝 Edit Meet Name", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Name", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let set_meet_location_menu = new Menu("furmeet_creation_set_location")
            .text("📝 Edit Location", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");

                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Location by attaching a Telegram Location using the attach button!", true);
            })
            .text("🌎 See Location", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                if (user_state_machine.meet_location.valid){
                    let location = user_state_machine.meet_location;
                    await this.menu_send_status_message(context, `${location.name} located @ ${location.address}`, false);

                    await this.telegram_bot.api.sendLocation(context.chat!.id, location.location.latitude, location.location.longitude);
                }else{
                    await this.menu_send_status_message(context, "Location is not specified", false);
                }
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })

        let set_meet_date_menu = new Menu("furmeet_creation_set_date")
            .text("📝 Write a Message", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the date");

                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Date by writing a date. I will try my best to understand it!", true);
            })
            .row()
            .submenu("📝 Edit Month", "furmeet_creation_set_date_month")
            .submenu("📝 Edit Date", "furmeet_creation_set_date_day")
            .row()
            .submenu("📝 Edit Hour", "furmeet_creation_set_hour_time")
            .submenu("📝 Edit Minute", "furmeet_creation_set_minute_time")
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

        let set_meet_date_month_menu = new Menu("furmeet_creation_set_date_month");

        for (let i = 0;i<months.length;i++){
            let month = months[i]!;

            set_meet_date_month_menu.back(month, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setMonth(i);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
            set_meet_date_month_menu.row();
        }
        set_meet_date_month_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_date_day_menu = new Menu("furmeet_creation_set_date_day");

        for (let i = 0;i<31;i++){
            
            if (i != 0 && i % 7 == 0){
                set_meet_date_day_menu.row();
            }
            set_meet_date_day_menu.back(`${i + 1}`, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setDate(i + 1);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_date_day_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_hour_time_menu = new Menu("furmeet_creation_set_hour_time");

        for (let i = 0;i<24;i++){
            
            if (i != 0 && i % 3 == 0){
                set_meet_hour_time_menu.row();
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

            set_meet_hour_time_menu.back((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                let minute = user_state_machine.meet_date.getMinutes();

                return `${hour}:${minute < 10 ? `0${minute}` : minute} ${designator}`;
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setHours(i);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_hour_time_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_minute_time_menu = new Menu("furmeet_creation_set_minute_time");

        for (let i = 0;i<12;i++){
            
            if (i != 0 && i % 3 == 0){
                set_meet_minute_time_menu.row();
            }

            let minute = i * 5;

            set_meet_minute_time_menu.back((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;


                // absolute cancer
                let hour = user_state_machine.meet_date.getHours();

                let designator = "AM";

                if (hour >= 12){
                    hour -= 12;
                    designator = "PM";
                }

                if (hour == 0){
                    hour = 12;
                }

                return `${hour}:${minute < 10 ? `0${minute}` : minute} ${designator}`;
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setMinutes(minute);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_minute_time_menu.back("❌ Cancel", async (context)=>{
        });

        let set_planner_contacts_menu = new Menu("furmeet_creation_set_planner_contacts")
            .text("📨 Specify Telegram Contact", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the Planner's Telegram Username", true);
                user_state_machine.planner_contact.enter_field_mode = "Telegram";
            })
            .row()
            .text("🎮 Specify Discord Contact", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                await this.menu_send_status_message(context, "Enter the Planner's Discord Username", true);
                user_state_machine.planner_contact.enter_field_mode = "Discord";
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let set_meet_description_menu = new Menu("furmeet_creation_set_meet_description")
            .text("📝 Edit Meet Description", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Description", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
            
        let set_meet_media_menu = new Menu("furmeet_creation_set_meet_media")
            .text("📝 Edit Meet Media", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the media");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                await this.menu_send_status_message(context, "Upload the new Meet Media using the attachment button!", true);
            })
            .row()
            .text("🗑️ Clear Media", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                if (user_state_machine.meet_media){
                    user_state_machine.meet_media = undefined
                    await this.menu_send_status_message(context, "Media Media has been cleared!", false);
                    await this.menu_interaction_state_machine(context, "MeetMedia");
                }else{
                    await this.menu_send_status_message(context, "Meet Media already has been cleared. There is no attached media.", false);
                }
            })
            .row()
            .text("🔭 Preview Media", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                if (user_state_machine.meet_media){
                    await this.menu_send_status_image(context, user_state_machine.meet_media, "Meet Media Preview");
                }else{
                    await this.menu_send_status_message(context, "There is no meet media.", true);
                }
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let cancelled_menu = new Menu("furmeet_creation_cancelled");

        let last_confirm_menu = new Menu("furmeet_creation_last_confirm")
            .back("🔙 Return and continue editing...", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })
            .row()
            .submenu("✅ Submit Meet", "furmeet_creation_confirmed", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_interaction_state_machine(context, "Confirmed");

                meet_manager.post_meet({
                    planner: {
                        discord: user_state_machine.planner_contact.discord_username,
                        telegram: user_state_machine.planner_contact.telegram_username
                    },
                    platform_specifics: {
                        username: {
                            username: context.from.username,
                            user_id: context.from.id,
                            full_name: `${context.from.first_name} ${context.from.last_name}`
                        },
                        platform: "Telegram",
                        telegram: {
                            message_id: 0,
                            chat_id: 0
                        }
                    },
                    meet_name: user_state_machine.meet_name,
                    meet_location: {
                        name: user_state_machine.meet_location.name,
                        address: user_state_machine.meet_location.address,
                        location: {
                            latitude: user_state_machine.meet_location.location.latitude,
                            longitude: user_state_machine.meet_location.location.longitude
                        },
                        valid: user_state_machine.meet_location.valid
                    },
                    meet_date: user_state_machine.meet_date,
                    meet_description: user_state_machine.meet_description,
                    meet_disabled: false,
                    attached_meet_media: user_state_machine.meet_media
                });
            });

        let confirmed_menu = new Menu("furmeet_creation_confirmed");

        intro_menu.register(main_menu);
        main_menu.register(set_meet_name_menu);
        main_menu.register(set_meet_location_menu);
        main_menu.register(set_meet_date_menu);
        set_meet_date_menu.register(set_meet_date_month_menu);
        set_meet_date_menu.register(set_meet_date_day_menu);
        set_meet_date_menu.register(set_meet_hour_time_menu);
        set_meet_date_menu.register(set_meet_minute_time_menu);
        main_menu.register(set_planner_contacts_menu);
        main_menu.register(set_meet_description_menu);
        main_menu.register(set_meet_media_menu);
        main_menu.register(cancelled_menu);
        main_menu.register(last_confirm_menu);
        last_confirm_menu.register(confirmed_menu);

        telegram_bot.use(intro_menu);
    }

    state_machine_obtain_menu_identifier(context: Context){
        if (
            !context.from ||
            !context.update.callback_query ||
            !context.update.callback_query.message ||
            !context.chat
        )
            return null;

        return `${this.state_machine_obtain_user_chat_identifier(context)}/${context.chat.id}`
    }

    state_machine_obtain_user_chat_identifier(context: Context){
        if (
            !context.from ||
            !context.chat
        )
            return null;

        return `/${context.chat.id}/${context.from.id}`
    }

    state_machine_obtain_user_states(context: Context){

        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


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

    state_machine_clear_user_states(context: Context){
        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


        if (menu_identifier)
            this.user_state_machines.delete(menu_identifier);

        if (user_chat_identifier)
            this.user_state_machines.delete(user_chat_identifier);
    }

    async state_machine_operation(context: Context, new_state: FurmeetCreation_UserStates){

        
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        user_state_machine.state = new_state;

        switch (user_state_machine.state){
            case "Confirmed":
            case "Cancelled":{
                setTimeout(() => {
                    this.state_machine_clear_user_states(context);
                }, 100);
                break;
            }
        }
    }

    state_machine_get_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return "";

        switch (user_state_machine.state){
            case "IntroMenu":{
                return `You have activated the command that will allow you to create a furmeet for everyone to see!\n\n` +
                    `To get started, please press the <b>Create a furmeet</b> button!\n\n` + 
                    `<i>Note this button has a slowmode. You can only create a meet every hour.</i>`;
            }
            case "MainMenu":{
                return `You are creating a meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    `<i><u>Hint: You can forward me the message the planner sent and I can autofill most details!</u></i>`;
            }
            case "MainMenu":{
                return `You are creating a meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    `<i><u>Hint: You can forward me the message the planner sent and I can autofill most details!</u></i>`;
            }
            case "MeetName":{
                return `You are changing the <b>Meet Name</b>.\n\n` + 
                    `Currently, it is <u>${user_state_machine.meet_name}</u>.\n` +
                    `To change it, specify a new name in the chat or press the <b>Edit Meet Name</b> button.`;
            }
            case "MeetLocation":{
                return `You are changing the <b>Meet Location</b>.\n\n` + 
                    `Currently, the meet is hosted at <u>${user_state_machine.meet_location.name}</u>.\n` +
                    `To change it, specify a Telegram Location using the attachment button..`;
            }
            case "MeetDate":{
                return `You are changing the <b>Meet Date</b>.\n\n` + 
                    `Currently, the meet is on <u>${`${format_date(user_state_machine.meet_date)}`}</u>.\n` +
                    `To change it, click on the following buttons to begin or...\n` +
                    `Write me a time or date and I can try my best to understand!`;
            }
            case "MeetPlanner":{
                return `You are changing the <b>Planner's Contact Information</b>.\n\n` + 
                    (user_state_machine.planner_contact.discord_username ? 
                        `Their Discord Username is <u>${user_state_machine.planner_contact.discord_username}</u>.\n` :
                        `There is <b>no Discord Contact Information.</b>\n`) +
                    (user_state_machine.planner_contact.telegram_username ? 
                        `Their Telegram Username is <u>@${user_state_machine.planner_contact.telegram_username}</u>.\n` :
                        `There is <b>no Telegram Contact Information.</b>\n`) +
                    `To change it, click on the following buttons to begin or...`;
            }
            case "MeetDescription":{
                return `You are changing the <b>Meet Description</b>.\n\n` + 
                (user_state_machine.meet_description ? 
                        `Currently it reads...\n` +
                        `<i>${user_state_machine.meet_description}</i>\n\n` :
                        `The description is empty. You would need to specify the description.\n\n`
                    ) +
                    `To change it, specify a new description in the chat or press the <b>Edit Meet Description</b> button.`;
            }
            case "MeetMedia":{
                if (user_state_machine.meet_media){
                    return `You are changing the <b>Meet Media</b>.\n\n` + 
                        `You have uploaded a media of size ${user_state_machine.meet_media.byteLength} bytes.\n` +
                        `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
                }else{
                    return `You are changing the <b>Meet Media</b>.\n\n` + 
                        `There is no uploaded media.\n` +
                        `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
                }
            }
            case "Cancelled":{
                return `You cancelled creating this furmeet. You are free to start this process whenevever you want.`
            }
            case "LastConfirm":{

                let warnings = "";

                if (user_state_machine.meet_date.getTime() < Date.now()){
                    warnings += "⚠️ This meet has happened in the past and will not be tracked and announced. Please return back and fix this! ⚠️\n";
                }

                // TODO: Add checker for if there is a meet already on that day

                return `<b>Please confirm the details before submitting. You cannot edit this meet once submitted!</b>.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    (warnings ? `<b><u>${warnings}</u></b>` : "");
            }
            case "Confirmed":{
                return `You submitted this meet! It will be announced soon to all channels! :3`
            }
        }
    }

    async menu_interaction_state_machine(context: Context, new_state: FurmeetCreation_UserStates){
        
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        await this.state_machine_operation(context, new_state);
        context.editMessageText(this.state_machine_get_message(context), {
            parse_mode: "HTML"
        });
        await this.menu_clear_status_message(context);
        user_state_machine.last_menu_context = context;
    }

    async menu_update_text(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        if (user_state_machine.last_menu_context){
            user_state_machine.last_menu_context.editMessageText(this.state_machine_get_message(context), {
                parse_mode: "HTML"
            });
        }

    }

    async menu_generate(context: Context){

        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);

        if (!user_chat_identifier){
            return null;
        }

        let new_user_state_machine: FurmeetCreation_UserStateMachine = {
            state: "IntroMenu",
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
            meet_date: new Date("January 1 2026 6:21:00 AM"),
            last_menu_context: undefined,
            meet_description: "",
            meet_media: undefined,
            planner_contact: {
                discord_username: "",
                telegram_username: context.from?.username || "Unknown",
                enter_field_mode: "Telegram"
            }
        };


        this.user_state_machines.set(user_chat_identifier, new_user_state_machine);

        let initial_message = this.state_machine_get_message(context);

        let message = await context.reply(initial_message, {
            protect_content: true,
            parse_mode: "HTML",
            reply_markup: this.intro_menu,
        });

        let menu_identifier = `${user_chat_identifier}/${message.message_id}`;

        this.user_state_machines.set(menu_identifier, new_user_state_machine);
    }

    async menu_send_status_message(context: Context, text: string, force_reply: boolean = false){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.menu_clear_status_message(context);
        }

        // telegram u stopid
        
        if (force_reply){
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                reply_markup: {
                    force_reply: true
                },
                parse_mode: "HTML"
            });
        }else{
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                parse_mode: "HTML"
            });
        }
    }

    async menu_send_status_image(context: Context, image: Buffer, text: string){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.menu_clear_status_message(context);
        }
        
        user_state_machine.force_reply_request = await context.replyWithPhoto(new InputFile(image), {
            caption: text,
            protect_content: true,
            parse_mode: "HTML"
        });
    }

    async menu_clear_status_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.telegram_bot.api.deleteMessage(force_reply_request.chat.id, force_reply_request.message_id);

            user_state_machine.force_reply_request = undefined;
        }
    }

    async on_general_message_event(context: Context){

        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        switch(user_state_machine.state){
            case "MeetName":{
                
                let user_message = context.message!;
                let new_meet_name = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the name of this meet to <b>${new_meet_name}</b>`);

                user_state_machine.meet_name = new_meet_name;

                this.menu_update_text(context);

                break;
            }
            case "MeetLocation":{
                
                let user_message = context.message!;
                let meet_location = user_message.text!;
                
                let venue_location = user_message.venue;

                let location_name = user_message.text || "Unknown Location";

                if (venue_location){
                    location_name = venue_location.title;
                    await this.menu_send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>\n`);
                    
                    user_state_machine.meet_location.location = venue_location.location;
                    user_state_machine.meet_location.address = venue_location.address;
                }else{
                    await this.menu_send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>.\n` +
                        `This location cannot be looked up from its name and therefore map context features cannot be used.`
                    );
                }

                user_state_machine.meet_location.valid = true;
                user_state_machine.meet_location.name = location_name;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);

                this.menu_update_text(context);

                break;
            }
            case "MeetDescription":{
                
                let user_message = context.message!;
                let new_meet_description = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the description of this meet to <b>${new_meet_description}</b>`);

                user_state_machine.meet_description = new_meet_description;

                this.menu_update_text(context);

                break;
            }
            case "MeetMedia":{
                let user_message = context.message!;
                console.log(user_message);

                if (user_message.photo){
                    let largest_photo = user_message.photo[0]!;

                    for (let i = 1;i<user_message.photo.length;i++){
                        if (user_message.photo[i]!.file_size! > largest_photo.file_size!){
                            largest_photo = user_message.photo[i]!;
                        }
                    }

                    await this.menu_send_status_message(context, `Downloading media...`);

                    let telegram_file = await this.telegram_bot.api.getFile(largest_photo.file_id);
                    let downloaded_photo = await this.telegram_handler.download_telegram_image(telegram_file);

                    user_state_machine.meet_media = downloaded_photo;

                    await context.deleteMessage();
                    await this.menu_send_status_message(context, `Media downloaded!`);
                }else{
                    await this.menu_send_status_message(context, `The message you have sent does not contain any media.`);
                }

                this.menu_update_text(context);
                break;
            }
            case "MeetPlanner":{
                
                let user_message = context.message!;
                let planner_username = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);

                if (user_state_machine.planner_contact.enter_field_mode == "Telegram"){
                    await this.menu_send_status_message(context, `The Planner's Contact Telegram Username is set to <b>@${planner_username}</b>`);
                    user_state_machine.planner_contact.telegram_username = planner_username;
                }else{
                    await this.menu_send_status_message(context, `The Planner's Contact Discord Username is set to <b>${planner_username}</b>`);
                    user_state_machine.planner_contact.discord_username = planner_username;
                }

                this.menu_update_text(context);

                break;
            }
            case "MeetDate":{

                let user_message = context.message!;
                let new_meet_date = ` ${user_message.text!} `;


                let identified_date = user_state_machine.meet_date;
                let was_identifiable = false;


                // yes will reduce this clutter.
                if (new_meet_date.match(/Next Week/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400 * 7);
                    was_identifiable = true
                }else if (new_meet_date.match(/Tomorrow/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400);
                    was_identifiable = true
                }else{
                    let month_matches: [string, number][] = [
                        ["Jan", 0],
                        ["January", 0],
                        ["February", 1],
                        ["Feb", 1],
                        ["March", 2],
                        ["Mar", 2],
                        ["April", 3],
                        ["Apr", 3],
                        ["May", 4],
                        ["June", 5],
                        ["July", 6],
                        ["Aug", 7],
                        ["August", 7],
                        ["Sept", 8],
                        ["September", 8],
                        ["Oct", 9],
                        ["October", 9],
                        ["Nov", 10],
                        ["November", 10],
                        ["Dec", 11],
                        ["December", 11],
                    ];

                    let identified_month_str = "";

                    for (let month_match of month_matches){
                        if (new_meet_date.match(new RegExp(` ${month_match[0]} `, "i"))){

                            if (month_match[1] < 5 && new Date().getMonth() == 11){
                                identified_date.setFullYear(identified_date.getFullYear() + 1);
                            }
                            

                            // fuck this logic, will fix later.
                            identified_date.setMonth(month_match[1]);
                            identified_date.setMonth(month_match[1]);
                            identified_month_str = month_match[0];
                            was_identifiable = true
                            break;
                        }
                    }

                    if (was_identifiable){
                        let identified_likely_date = 
                            new_meet_date.match(new RegExp(`${identified_month_str} (\\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)`, "i"));

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }else{
                        let identified_likely_date = new_meet_date.match(/(\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)/);

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }
                    
                    
                    let identified_likely_time = new_meet_date
                        .match(/(?<Hour>\d{1,2})(?::(?<Minute>\d{2}))?(?::(?<Second>\d{2}))? ?(?<Segment>(?:am)|(?:pm))/i);

                    if (identified_likely_time){

                        let hour = identified_likely_time.groups!.Hour;
                        let minute = identified_likely_time.groups!.Minute;
                        let second = identified_likely_time.groups!.Second;
                        let segment = identified_likely_time.groups!.Segment!.toUpperCase();

                        let hour_str = String(hour);

                        let minute_str = "00";
                        if (minute){
                            minute_str = `${(Number(minute) < 10) ? 0 : ""}${minute}`;
                        }

                        let second_str = "00";
                        if (second){
                            second_str = `${(Number(second) < 10) ? 0 : ""}${second}`;
                        }
                    

                        identified_date = new Date(`${identified_date.toDateString()} ${hour_str}:${minute_str}:${second_str} ${segment}`);
                    }
                }

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the time of this meet to <b>${identified_date.toLocaleString()}</b>`);

                user_state_machine.meet_date = identified_date;

                this.menu_update_text(context);

                break;
            }
            case "MainMenu":{
                let message = context.message;

                if (!message)
                    break;

                let meet_info_text = message.text || message.caption || "";
                let is_image = message.photo != null;

                // let image: Buffer | undefined;

                // if (is_image){
                //     let files = message.photo!;
                //     let file = files[files.length - 1];

                //     let downloadable_file = await telegram_bot.api.getFile(file!.file_id);

                //     image = await download_image(`https://api.telegram.org/file/bot${telegram_bot_api_key}/${downloadable_file.file_path}`);
                // }

                let identified_pinner = message.from.username || "unknown";
                let identified_planner = 
                    ((message as any).forward_from || {username: "unknown"}).username;

                let identified_date = new Date();
                identified_date = new Date(`${identified_date.toDateString()} 11:00:00 AM GMT-0700 (Mountain Standard Time)`);
                let was_identifiable = false;

                if (meet_info_text.match(/Next Week/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400 * 7);
                    was_identifiable = true
                }else if (meet_info_text.match(/Tomorrow/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400);
                    was_identifiable = true
                }else{
                    let month_matches: [string, number][] = [
                        ["Jan", 0],
                        ["January", 0],
                        ["February", 1],
                        ["Feb", 1],
                        ["March", 2],
                        ["Mar", 2],
                        ["April", 3],
                        ["Apr", 3],
                        ["May", 4],
                        ["June", 5],
                        ["July", 6],
                        ["Aug", 7],
                        ["August", 7],
                        ["Sept", 8],
                        ["September", 8],
                        ["Oct", 9],
                        ["October", 9],
                        ["Nov", 10],
                        ["November", 10],
                        ["Dec", 11],
                        ["December", 11],
                    ];

                    let identified_month_str = "";

                    for (let month_match of month_matches){
                        if (meet_info_text.match(new RegExp(` ${month_match[0]} `, "i"))){

                            if (month_match[1] < 5 && new Date().getMonth() == 11){
                                identified_date.setFullYear(identified_date.getFullYear() + 1);
                            }

                            // fuck this logic, will fix later.
                            identified_date.setMonth(month_match[1]);
                            identified_date.setMonth(month_match[1]);
                            identified_month_str = month_match[0];
                            was_identifiable = true
                            break;
                        }
                    }

                    if (was_identifiable){
                        let identified_likely_date = 
                            meet_info_text.match(new RegExp(`${identified_month_str} (\\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)`, "i"));

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }else{
                        let identified_likely_date = meet_info_text.match(/(\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)/);

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }
                    
                    
                    let identified_likely_time = meet_info_text
                        .match(/(?<Hour>\d{1,2})(?::(?<Minute>\d{2}))?(?::(?<Second>\d{2}))? ?(?<Segment>(?:am)|(?:pm))/i);

                    if (identified_likely_time){

                        let hour = identified_likely_time.groups!.Hour;
                        let minute = identified_likely_time.groups!.Minute;
                        let second = identified_likely_time.groups!.Second;
                        let segment = identified_likely_time.groups!.Segment!.toUpperCase();

                        let hour_str = String(hour);

                        let minute_str = "00";
                        if (minute){
                            minute_str = `${(Number(minute) < 10) ? 0 : ""}${minute}`;
                        }

                        let second_str = "00";
                        if (second){
                            second_str = `${(Number(second) < 10) ? 0 : ""}${second}`;
                        }
                    

                        identified_date = new Date(`${identified_date.toDateString()} ${hour_str}:${minute_str}:${second_str} ${segment}`);
                    }
                }

                user_state_machine.meet_description = meet_info_text;
                user_state_machine.meet_date = identified_date;
                user_state_machine.planner_contact.telegram_username = identified_planner;

                await this.menu_send_status_message(context,
                    `I was able to pull some details from the forwarded message...\n\n` +
                    `I have determined the date as <b>${identified_date.toLocaleString()}</b> and <b>@${identified_planner}</b> is the planner!`
                )

                this.menu_update_text(context);
            }
        }
    }

    async on_foward_message_event(context: Context){

        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

    }
}


class FurmeetManager_GenMenu{

    private main_menu: Menu;
    private intro_menu: Menu;

    private telegram_bot: Bot;
    private telegram_handler: TelegramHandler;
    private meet_manager: MeetManager;
    private user_state_machines = new Map<string, FurmeetManager_UserStateMachine>();

    constructor(telegram_bot: Bot, telegram_handler: TelegramHandler, meet_manager: MeetManager){
        this.telegram_handler = telegram_handler;
        this.telegram_bot = telegram_bot;
        this.meet_manager = meet_manager;

        let intro_menu = this.intro_menu = new Menu("furmeet_manager_initial")
            .submenu("Manage/Edit the furmeet!", "furmeet_manager_root", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
        
        let main_menu = this.main_menu = new Menu("furmeet_manager_root")
            .submenu("🏷️ Set Meet Name", "furmeet_manager_set_meet_name", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetName");
            })
            .submenu("🗺️ Set Location", "furmeet_manager_set_location", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetLocation");
            })
            .row()
            .submenu("📅 Set Meet Date", "furmeet_manager_set_date", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetDate");
            })
            .submenu("📱 Set Contact Info", "furmeet_manager_set_planner_contacts", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetPlanner");
            })
            .row()
            .submenu("🗒️ Set Description", "furmeet_manager_set_meet_description", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetDescription");
            })
            .submenu("🖼️ Attach Media", "furmeet_manager_set_meet_media", async (context)=>{
                await this.menu_interaction_state_machine(context, "MeetMedia");
            })
            .row()
            .submenu("🗑️ Delete", "furmeet_manager_deleted", async (context)=>{
                await this.menu_interaction_state_machine(context, "LastDelete");
            })
            .row()
            .submenu("❌ Cancel", "furmeet_manager_cancelled", async (context)=>{
                await this.menu_interaction_state_machine(context, "Cancelled");
            })
            .submenu("✅ Submit", "furmeet_manager_last_confirm", async (context)=>{
                await this.menu_interaction_state_machine(context, "LastConfirm");
            })

        let set_meet_name_menu = new Menu("furmeet_manager_set_meet_name")
            .text("📝 Edit Meet Name", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Name", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let set_meet_location_menu = new Menu("furmeet_manager_set_location")
            .text("📝 Edit Location", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the locatiion");

                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Location by attaching a Telegram Location using the attach button!", true);
            })
            .text("🌎 See Location", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                if (user_state_machine.meet_location.valid){
                    let location = user_state_machine.meet_location;
                    await this.menu_send_status_message(context, `${location.name} located @ ${location.address}`, false);

                    await this.telegram_bot.api.sendLocation(context.chat!.id, location.location.latitude, location.location.longitude);
                }else{
                    await this.menu_send_status_message(context, "Location is not specified", false);
                }
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })

        let set_meet_date_menu = new Menu("furmeet_manager_set_date")
            .text("📝 Write a Message", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the date");

                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Date by writing a date. I will try my best to understand it!", true);
            })
            .row()
            .submenu("📝 Edit Month", "furmeet_manager_set_date_month")
            .submenu("📝 Edit Date", "furmeet_manager_set_date_day")
            .row()
            .submenu("📝 Edit Hour", "furmeet_manager_set_hour_time")
            .submenu("📝 Edit Minute", "furmeet_manager_set_minute_time")
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

        let set_meet_date_month_menu = new Menu("furmeet_manager_set_date_month");

        for (let i = 0;i<months.length;i++){
            let month = months[i]!;

            set_meet_date_month_menu.back(month, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setMonth(i);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
            set_meet_date_month_menu.row();
        }
        set_meet_date_month_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_date_day_menu = new Menu("furmeet_manager_set_date_day");

        for (let i = 0;i<31;i++){
            
            if (i != 0 && i % 7 == 0){
                set_meet_date_day_menu.row();
            }
            set_meet_date_day_menu.back(`${i + 1}`, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setDate(i + 1);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_date_day_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_hour_time_menu = new Menu("furmeet_manager_set_hour_time");

        for (let i = 0;i<24;i++){
            
            if (i != 0 && i % 3 == 0){
                set_meet_hour_time_menu.row();
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

            set_meet_hour_time_menu.back((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                let minute = user_state_machine.meet_date.getMinutes();

                return `${hour}:${minute < 10 ? `0${minute}` : minute} ${designator}`;
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setHours(i);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_hour_time_menu.back("❌ Cancel", async (context)=>{
        });

        let set_meet_minute_time_menu = new Menu("furmeet_manager_set_minute_time");

        for (let i = 0;i<12;i++){
            
            if (i != 0 && i % 3 == 0){
                set_meet_minute_time_menu.row();
            }

            let minute = i * 5;

            set_meet_minute_time_menu.back((context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;


                // absolute cancer
                let hour = user_state_machine.meet_date.getHours();

                let designator = "AM";

                if (hour >= 12){
                    hour -= 12;
                    designator = "PM";
                }

                if (hour == 0){
                    hour = 12;
                }

                return `${hour}:${minute < 10 ? `0${minute}` : minute} ${designator}`;
            }, async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                user_state_machine.meet_date.setMinutes(minute);
                await this.menu_interaction_state_machine(context, "MeetDate");
            });
        }
        set_meet_minute_time_menu.back("❌ Cancel", async (context)=>{
        });

        let set_planner_contacts_menu = new Menu("furmeet_manager_set_planner_contacts")
            .text("📨 Specify Telegram Contact", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the Planner's Telegram Username", true);
                user_state_machine.planner_contact.enter_field_mode = "Telegram";
            })
            .row()
            .text("🎮 Specify Discord Contact", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                await this.menu_send_status_message(context, "Enter the Planner's Discord Username", true);
                user_state_machine.planner_contact.enter_field_mode = "Discord";
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let set_meet_description_menu = new Menu("furmeet_manager_set_meet_description")
            .text("📝 Edit Meet Description", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the description");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_send_status_message(context, "Enter the new Meet Description", true);
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });
            
        let set_meet_media_menu = new Menu("furmeet_manager_set_meet_media")
            .text("📝 Edit Meet Media", async (context)=>{
                await context.answerCallbackQuery("Please follow the prompt below to submit the media");
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                await this.menu_send_status_message(context, "Upload the new Meet Media using the attachment button!", true);
            })
            .row()
            .text("🗑️ Clear Media", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                if (user_state_machine.meet_media){
                    user_state_machine.meet_media = undefined
                    await this.menu_send_status_message(context, "Media Media has been cleared!", false);
                    await this.menu_interaction_state_machine(context, "MeetMedia");
                }else{
                    await this.menu_send_status_message(context, "Meet Media already has been cleared. There is no attached media.", false);
                }
            })
            .row()
            .text("🔭 Preview Media", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;
                
                if (user_state_machine.meet_media){
                    await this.menu_send_status_image(context, user_state_machine.meet_media, "Meet Media Preview");
                }else{
                    await this.menu_send_status_message(context, "There is no meet media.", true);
                }
            })
            .row()
            .back("🔙 Back", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            });

        let cancelled_menu = new Menu("furmeet_manager_cancelled");

        let last_confirm_delete_menu = new Menu("furmeet_manager_deleted")
            .back("🔙 Return and do not delete...", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })
            .row()
            .submenu("🗑️ Delete Meet", "furmeet_manager_confirmed_deleted", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_interaction_state_machine(context, "Deleted");

                user_state_machine.linked_meet.meet_disabled = true;
                
                await this.meet_manager.delete_meet(user_state_machine.linked_meet.meet_id);
            });

        let confirmed_delete_menu = new Menu("furmeet_manager_confirmed_deleted");

        let last_confirm_menu = new Menu("furmeet_manager_last_confirm")
            .back("🔙 Return and continue editing...", async (context)=>{
                await this.menu_interaction_state_machine(context, "MainMenu");
            })
            .row()
            .submenu("✅ Submit Meet", "furmeet_manager_confirmed", async (context)=>{
                let user_state_machine = this.state_machine_obtain_user_states(context)!;

                await this.menu_interaction_state_machine(context, "Confirmed");


                let meet = user_state_machine.linked_meet;
                
                meet_manager.edit_meet(meet.meet_id, {
                    planner: {
                        discord: user_state_machine.planner_contact.discord_username,
                        telegram: user_state_machine.planner_contact.telegram_username
                    },
                    platform_specifics: {
                        username: {
                            username: context.from.username,
                            user_id: context.from.id,
                            full_name: `${context.from.first_name} ${context.from.last_name}`
                        },
                        platform: "Telegram",
                        telegram: {
                            message_id: 0,
                            chat_id: 0
                        }
                    },
                    meet_name: user_state_machine.meet_name,
                    meet_location: {
                        name: user_state_machine.meet_location.name,
                        address: user_state_machine.meet_location.address,
                        location: {
                            latitude: user_state_machine.meet_location.location.latitude,
                            longitude: user_state_machine.meet_location.location.longitude
                        },
                        valid: user_state_machine.meet_location.valid
                    },
                    meet_date: user_state_machine.meet_date,
                    meet_description: user_state_machine.meet_description,
                    meet_disabled: false,
                    attached_meet_media: user_state_machine.meet_media
                });
            });

        let confirmed_menu = new Menu("furmeet_manager_confirmed");

        intro_menu.register(main_menu);
        main_menu.register(set_meet_name_menu);
        main_menu.register(set_meet_location_menu);
        main_menu.register(set_meet_date_menu);
        set_meet_date_menu.register(set_meet_date_month_menu);
        set_meet_date_menu.register(set_meet_date_day_menu);
        set_meet_date_menu.register(set_meet_hour_time_menu);
        set_meet_date_menu.register(set_meet_minute_time_menu);
        main_menu.register(set_planner_contacts_menu);
        main_menu.register(set_meet_description_menu);
        main_menu.register(set_meet_media_menu);
        main_menu.register(cancelled_menu);
        main_menu.register(last_confirm_delete_menu);
        last_confirm_delete_menu.register(confirmed_delete_menu);
        main_menu.register(last_confirm_menu);
        last_confirm_menu.register(confirmed_menu);

        telegram_bot.use(intro_menu);
    }

    state_machine_obtain_menu_identifier(context: Context){
        if (
            !context.from ||
            !context.update.callback_query ||
            !context.update.callback_query.message ||
            !context.chat
        )
            return null;

        return `${this.state_machine_obtain_user_chat_identifier(context)}/${context.chat.id}`
    }

    state_machine_obtain_user_chat_identifier(context: Context){
        if (
            !context.from ||
            !context.chat
        )
            return null;

        return `/${context.chat.id}/${context.from.id}`
    }

    state_machine_obtain_user_states(context: Context){

        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


        let user_state_machine: FurmeetManager_UserStateMachine | undefined;
        
        if (!menu_identifier && !user_chat_identifier){
            return null;
        }

        if (menu_identifier)
            user_state_machine = this.user_state_machines.get(menu_identifier);

        if (user_chat_identifier)
            user_state_machine = this.user_state_machines.get(user_chat_identifier);

        return user_state_machine;
    }

    state_machine_clear_user_states(context: Context){
        let menu_identifier = this.state_machine_obtain_menu_identifier(context);
        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);


        if (menu_identifier)
            this.user_state_machines.delete(menu_identifier);

        if (user_chat_identifier)
            this.user_state_machines.delete(user_chat_identifier);
    }

    async state_machine_operation(context: Context, new_state: FurmeetManager_UserStates){

        
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        user_state_machine.state = new_state;

        switch (user_state_machine.state){
            case "Deleted":
            case "Confirmed":
            case "Cancelled":{
                setTimeout(() => {
                    this.state_machine_clear_user_states(context);
                }, 100);
                break;
            }
        }
    }

    state_machine_get_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return "";

        switch (user_state_machine.state){
            case "IntroMenu":{
                return `You have activated the command that will allow you to edit the furmeet!\n\n` +
                    `To get started, please press the <b>Manage/Edit the furmeet</b> button!\n\n`;
            }
            case "MainMenu":{
                return `You are editing the meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    `<i><u>Hint: You can forward me the message the planner sent and I can autofill most details!</u></i>`;
            }
            case "MainMenu":{
                return `You are editing the meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    `<i><u>Hint: You can forward me the message the planner sent and I can autofill most details!</u></i>`;
            }
            case "MeetName":{
                return `You are changing the <b>Meet Name</b>.\n\n` + 
                    `Currently, it is <u>${user_state_machine.meet_name}</u>.\n` +
                    `To change it, specify a new name in the chat or press the <b>Edit Meet Name</b> button.`;
            }
            case "MeetLocation":{
                return `You are changing the <b>Meet Location</b>.\n\n` + 
                    `Currently, the meet is hosted at <u>${user_state_machine.meet_location.name}</u>.\n` +
                    `To change it, specify a Telegram Location using the attachment button..`;
            }
            case "MeetDate":{
                return `You are changing the <b>Meet Date</b>.\n\n` + 
                    `Currently, the meet is on <u>${`${format_date(user_state_machine.meet_date)}`}</u>.\n` +
                    `To change it, click on the following buttons to begin or...\n` +
                    `Write me a time or date and I can try my best to understand!`;
            }
            case "MeetPlanner":{
                return `You are changing the <b>Planner's Contact Information</b>.\n\n` + 
                    (user_state_machine.planner_contact.discord_username ? 
                        `Their Discord Username is <u>${user_state_machine.planner_contact.discord_username}</u>.\n` :
                        `There is <b>no Discord Contact Information.</b>\n`) +
                    (user_state_machine.planner_contact.telegram_username ? 
                        `Their Telegram Username is <u>@${user_state_machine.planner_contact.telegram_username}</u>.\n` :
                        `There is <b>no Telegram Contact Information.</b>\n`) +
                    `To change it, click on the following buttons to begin or...`;
            }
            case "MeetDescription":{
                return `You are changing the <b>Meet Description</b>.\n\n` + 
                (user_state_machine.meet_description ? 
                        `Currently it reads...\n` +
                        `<i>${user_state_machine.meet_description}</i>\n\n` :
                        `The description is empty. You would need to specify the description.\n\n`
                    ) +
                    `To change it, specify a new description in the chat or press the <b>Edit Meet Description</b> button.`;
            }
            case "MeetMedia":{
                if (user_state_machine.meet_media){
                    return `You are changing the <b>Meet Media</b>.\n\n` + 
                        `You have uploaded a media of size ${user_state_machine.meet_media.byteLength} bytes.\n` +
                        `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
                }else{
                    return `You are changing the <b>Meet Media</b>.\n\n` + 
                        `There is no uploaded media.\n` +
                        `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
                }
            }
            case "Cancelled":{
                return `You cancelled creating this furmeet. You are free to start this process whenevever you want.`
            }
            case "LastDelete":{
                return `<b>Please confirm the details before deleting. You cannot bring this meet back once deleted!</b>.\n\n` + 
                    `You will be deleting the meet <u>${user_state_machine.meet_name}</u>\n`;
            }
            case "Deleted":{
                return `You have deleted this meet!`
            }
            case "LastConfirm":{

                let warnings = "";

                if (user_state_machine.meet_date.getTime() < Date.now()){
                    warnings += "⚠️ This meet has happened in the past and will not be tracked and announced. Please return back and fix this! ⚠️\n";
                }

                // TODO: Add checker for if there is a meet already on that day

                return `<b>Please confirm the details before submitting. You cannot edit this meet once submitted!</b>.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${format_date(user_state_machine.meet_date)}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    (warnings ? `<b><u>${warnings}</u></b>` : "");
            }
            case "Confirmed":{
                return `You submitted changes to this meet meet! :3`
            }
        }
    }

    async menu_interaction_state_machine(context: Context, new_state: FurmeetManager_UserStates){
        
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        await this.state_machine_operation(context, new_state);
        context.editMessageText(this.state_machine_get_message(context), {
            parse_mode: "HTML"
        });
        await this.menu_clear_status_message(context);
        user_state_machine.last_menu_context = context;
    }

    async menu_update_text(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        if (user_state_machine.last_menu_context){
            user_state_machine.last_menu_context.editMessageText(this.state_machine_get_message(context), {
                parse_mode: "HTML"
            });
        }

    }

    async menu_generate(context: Context, meet: Meet){

        let user_chat_identifier = this.state_machine_obtain_user_chat_identifier(context);

        if (!user_chat_identifier){
            return null;
        }

        let new_user_state_machine: FurmeetManager_UserStateMachine = {
            state: "IntroMenu",
            meet_name: meet.meet_name,
            force_reply_request: undefined,
            meet_location: meet.meet_location,
            meet_date: meet.meet_date,
            last_menu_context: undefined,
            meet_description: meet.meet_description,
            meet_media: meet.attached_meet_media,
            planner_contact: {
                discord_username: meet.planner.discord,
                telegram_username: meet.planner.telegram || "Unknown",
                enter_field_mode: "Telegram"
            },
            linked_meet: meet,
        };


        this.user_state_machines.set(user_chat_identifier, new_user_state_machine);

        let initial_message = this.state_machine_get_message(context);

        let message = await context.reply(initial_message, {
            protect_content: true,
            parse_mode: "HTML",
            reply_markup: this.intro_menu,
        });

        let menu_identifier = `${user_chat_identifier}/${message.message_id}`;

        this.user_state_machines.set(menu_identifier, new_user_state_machine);
    }

    async menu_send_status_message(context: Context, text: string, force_reply: boolean = false){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.menu_clear_status_message(context);
        }

        // telegram u stopid
        
        if (force_reply){
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                reply_markup: {
                    force_reply: true
                },
                parse_mode: "HTML"
            });
        }else{
            user_state_machine.force_reply_request = await context.reply(text, {
                protect_content: true,
                parse_mode: "HTML"
            });
        }
    }

    async menu_send_status_image(context: Context, image: Buffer, text: string){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;
        
        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.menu_clear_status_message(context);
        }
        
        user_state_machine.force_reply_request = await context.replyWithPhoto(new InputFile(image), {
            caption: text,
            protect_content: true,
            parse_mode: "HTML"
        });
    }

    async menu_clear_status_message(context: Context){
        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

        let force_reply_request = user_state_machine.force_reply_request;

        if (force_reply_request){
            await this.telegram_bot.api.deleteMessage(force_reply_request.chat.id, force_reply_request.message_id);

            user_state_machine.force_reply_request = undefined;
        }
    }

    async on_general_message_event(context: Context){

        let user_state_machine = this.state_machine_obtain_user_states(context);
        
        if (!user_state_machine)
            return;

        switch(user_state_machine.state){
            case "MeetName":{
                
                let user_message = context.message!;
                let new_meet_name = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the name of this meet to <b>${new_meet_name}</b>`);

                user_state_machine.meet_name = new_meet_name;

                this.menu_update_text(context);

                break;
            }
            case "MeetLocation":{
                
                let user_message = context.message!;
                let meet_location = user_message.text!;
                
                let venue_location = user_message.venue;

                let location_name = user_message.text || "Unknown Location";

                if (venue_location){
                    location_name = venue_location.title;
                    await this.menu_send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>\n`);
                    
                    user_state_machine.meet_location.location = venue_location.location;
                    user_state_machine.meet_location.address = venue_location.address;
                }else{
                    await this.menu_send_status_message(context, `You have set the location of this meet to <b>${location_name}</b>.\n` +
                        `This location cannot be looked up from its name and therefore map context features cannot be used.`
                    );
                }

                user_state_machine.meet_location.valid = true;
                user_state_machine.meet_location.name = location_name;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);

                this.menu_update_text(context);

                break;
            }
            case "MeetDescription":{
                
                let user_message = context.message!;
                let new_meet_description = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the description of this meet to <b>${new_meet_description}</b>`);

                user_state_machine.meet_description = new_meet_description;

                this.menu_update_text(context);

                break;
            }
            case "MeetMedia":{
                let user_message = context.message!;
                console.log(user_message);

                if (user_message.photo){
                    let largest_photo = user_message.photo[0]!;

                    for (let i = 1;i<user_message.photo.length;i++){
                        if (user_message.photo[i]!.file_size! > largest_photo.file_size!){
                            largest_photo = user_message.photo[i]!;
                        }
                    }

                    await this.menu_send_status_message(context, `Downloading media...`);

                    let telegram_file = await this.telegram_bot.api.getFile(largest_photo.file_id);
                    let downloaded_photo = await this.telegram_handler.download_telegram_image(telegram_file);

                    user_state_machine.meet_media = downloaded_photo;

                    await context.deleteMessage();
                    await this.menu_send_status_message(context, `Media downloaded!`);
                }else{
                    await this.menu_send_status_message(context, `The message you have sent does not contain any media.`);
                }

                this.menu_update_text(context);
                break;
            }
            case "MeetPlanner":{
                
                let user_message = context.message!;
                let planner_username = user_message.text!;

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);

                if (user_state_machine.planner_contact.enter_field_mode == "Telegram"){
                    await this.menu_send_status_message(context, `The Planner's Contact Telegram Username is set to <b>@${planner_username}</b>`);
                    user_state_machine.planner_contact.telegram_username = planner_username;
                }else{
                    await this.menu_send_status_message(context, `The Planner's Contact Discord Username is set to <b>${planner_username}</b>`);
                    user_state_machine.planner_contact.discord_username = planner_username;
                }

                this.menu_update_text(context);

                break;
            }
            case "MeetDate":{

                let user_message = context.message!;
                let new_meet_date = ` ${user_message.text!} `;


                let identified_date = user_state_machine.meet_date;
                let was_identifiable = false;


                // yes will reduce this clutter.
                if (new_meet_date.match(/Next Week/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400 * 7);
                    was_identifiable = true
                }else if (new_meet_date.match(/Tomorrow/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400);
                    was_identifiable = true
                }else{
                    let month_matches: [string, number][] = [
                        ["Jan", 0],
                        ["January", 0],
                        ["February", 1],
                        ["Feb", 1],
                        ["March", 2],
                        ["Mar", 2],
                        ["April", 3],
                        ["Apr", 3],
                        ["May", 4],
                        ["June", 5],
                        ["July", 6],
                        ["Aug", 7],
                        ["August", 7],
                        ["Sept", 8],
                        ["September", 8],
                        ["Oct", 9],
                        ["October", 9],
                        ["Nov", 10],
                        ["November", 10],
                        ["Dec", 11],
                        ["December", 11],
                    ];

                    let identified_month_str = "";

                    for (let month_match of month_matches){
                        if (new_meet_date.match(new RegExp(` ${month_match[0]} `, "i"))){

                            if (month_match[1] < 5 && new Date().getMonth() == 11){
                                identified_date.setFullYear(identified_date.getFullYear() + 1);
                            }
                            

                            // fuck this logic, will fix later.
                            identified_date.setMonth(month_match[1]);
                            identified_date.setMonth(month_match[1]);
                            identified_month_str = month_match[0];
                            was_identifiable = true
                            break;
                        }
                    }

                    if (was_identifiable){
                        let identified_likely_date = 
                            new_meet_date.match(new RegExp(`${identified_month_str} (\\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)`, "i"));

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }else{
                        let identified_likely_date = new_meet_date.match(/(\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)/);

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }
                    
                    
                    let identified_likely_time = new_meet_date
                        .match(/(?<Hour>\d{1,2})(?::(?<Minute>\d{2}))?(?::(?<Second>\d{2}))? ?(?<Segment>(?:am)|(?:pm))/i);

                    if (identified_likely_time){

                        let hour = identified_likely_time.groups!.Hour;
                        let minute = identified_likely_time.groups!.Minute;
                        let second = identified_likely_time.groups!.Second;
                        let segment = identified_likely_time.groups!.Segment!.toUpperCase();

                        let hour_str = String(hour);

                        let minute_str = "00";
                        if (minute){
                            minute_str = `${(Number(minute) < 10) ? 0 : ""}${minute}`;
                        }

                        let second_str = "00";
                        if (second){
                            second_str = `${(Number(second) < 10) ? 0 : ""}${second}`;
                        }
                    

                        identified_date = new Date(`${identified_date.toDateString()} ${hour_str}:${minute_str}:${second_str} ${segment}`);
                    }
                }

                await this.telegram_bot.api.deleteMessage(user_message.chat.id, user_message.message_id);
                await this.menu_send_status_message(context, `You have set the time of this meet to <b>${identified_date.toLocaleString()}</b>`);

                user_state_machine.meet_date = identified_date;

                this.menu_update_text(context);

                break;
            }
            case "MainMenu":{
                let message = context.message;

                if (!message)
                    break;

                let meet_info_text = message.text || message.caption || "";
                let is_image = message.photo != null;

                // let image: Buffer | undefined;

                // if (is_image){
                //     let files = message.photo!;
                //     let file = files[files.length - 1];

                //     let downloadable_file = await telegram_bot.api.getFile(file!.file_id);

                //     image = await download_image(`https://api.telegram.org/file/bot${telegram_bot_api_key}/${downloadable_file.file_path}`);
                // }

                let identified_pinner = message.from.username || "unknown";
                let identified_planner = 
                    ((message as any).forward_from || {username: "unknown"}).username;

                let identified_date = new Date();
                identified_date = new Date(`${identified_date.toDateString()} 11:00:00 AM GMT-0700 (Mountain Standard Time)`);
                let was_identifiable = false;

                if (meet_info_text.match(/Next Week/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400 * 7);
                    was_identifiable = true
                }else if (meet_info_text.match(/Tomorrow/i)){
                    identified_date = new Date(identified_date.getTime() + 1000 * 86400);
                    was_identifiable = true
                }else{
                    let month_matches: [string, number][] = [
                        ["Jan", 0],
                        ["January", 0],
                        ["February", 1],
                        ["Feb", 1],
                        ["March", 2],
                        ["Mar", 2],
                        ["April", 3],
                        ["Apr", 3],
                        ["May", 4],
                        ["June", 5],
                        ["July", 6],
                        ["Aug", 7],
                        ["August", 7],
                        ["Sept", 8],
                        ["September", 8],
                        ["Oct", 9],
                        ["October", 9],
                        ["Nov", 10],
                        ["November", 10],
                        ["Dec", 11],
                        ["December", 11],
                    ];

                    let identified_month_str = "";

                    for (let month_match of month_matches){
                        if (meet_info_text.match(new RegExp(` ${month_match[0]} `, "i"))){

                            if (month_match[1] < 5 && new Date().getMonth() == 11){
                                identified_date.setFullYear(identified_date.getFullYear() + 1);
                            }

                            // fuck this logic, will fix later.
                            identified_date.setMonth(month_match[1]);
                            identified_date.setMonth(month_match[1]);
                            identified_month_str = month_match[0];
                            was_identifiable = true
                            break;
                        }
                    }

                    if (was_identifiable){
                        let identified_likely_date = 
                            meet_info_text.match(new RegExp(`${identified_month_str} (\\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)`, "i"));

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }else{
                        let identified_likely_date = meet_info_text.match(/(\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)/);

                        if (identified_likely_date){
                            identified_date.setDate(Number(identified_likely_date[1]!));
                            was_identifiable = true
                        }
                    }
                    
                    
                    let identified_likely_time = meet_info_text
                        .match(/(?<Hour>\d{1,2})(?::(?<Minute>\d{2}))?(?::(?<Second>\d{2}))? ?(?<Segment>(?:am)|(?:pm))/i);

                    if (identified_likely_time){

                        let hour = identified_likely_time.groups!.Hour;
                        let minute = identified_likely_time.groups!.Minute;
                        let second = identified_likely_time.groups!.Second;
                        let segment = identified_likely_time.groups!.Segment!.toUpperCase();

                        let hour_str = String(hour);

                        let minute_str = "00";
                        if (minute){
                            minute_str = `${(Number(minute) < 10) ? 0 : ""}${minute}`;
                        }

                        let second_str = "00";
                        if (second){
                            second_str = `${(Number(second) < 10) ? 0 : ""}${second}`;
                        }
                    

                        identified_date = new Date(`${identified_date.toDateString()} ${hour_str}:${minute_str}:${second_str} ${segment}`);
                    }
                }

                user_state_machine.meet_description = meet_info_text;
                user_state_machine.meet_date = identified_date;
                user_state_machine.planner_contact.telegram_username = identified_planner;

                await this.menu_send_status_message(context,
                    `I was able to pull some details from the forwarded message...\n\n` +
                    `I have determined the date as <b>${identified_date.toLocaleString()}</b> and <b>@${identified_planner}</b> is the planner!`
                )

                this.menu_update_text(context);
            }
        }
    }

    async on_foward_message_event(context: Context){

        let user_state_machine = this.state_machine_obtain_user_states(context);

        if (!user_state_machine)
            return;

    }
}

class Furmeet_PostManager{

    private telegram_bot: Bot;
    private telegram_handler: TelegramHandler;
    private meet_manager: MeetManager;
    
    async send_message(chat_id: number, meet: Meet, body: string, image?: Buffer, is_announcement = false){
        if (image){
            if (is_announcement){
                return await this.telegram_bot.api.sendPhoto(chat_id, 
                    new InputFile(image), {
                        caption: body,
                        parse_mode: "HTML",
                        protect_content: true
                })
            }else{
                return await this.telegram_bot.api.sendPhoto(chat_id, 
                    new InputFile(image), {
                        caption: body,
                        parse_mode: "HTML",
                        reply_markup: this.get_meet_new_inline_keyboard(meet),
                        protect_content: true
                })
            }
        }else{
            if (is_announcement){
                return await this.telegram_bot.api.sendMessage(chat_id, 
                    body, {
                        parse_mode: "HTML",
                        link_preview_options: {
                            is_disabled: true
                        },
                        protect_content: true
                });
            }else{
                return await this.telegram_bot.api.sendMessage(chat_id, 
                    body, {
                        parse_mode: "HTML",
                        reply_markup: this.get_meet_new_inline_keyboard(meet),
                        link_preview_options: {
                            is_disabled: true
                        },
                        protect_content: true
                });
            }
        }
    }

    constructor(telegram_bot: Bot, telegram_handler: TelegramHandler, meet_manager: MeetManager){
        this.telegram_bot = telegram_bot;
        this.telegram_handler = telegram_handler;
        this.meet_manager = meet_manager;

        this.meet_manager.on("delete_meet", async (meet: Meet)=>{
            for (let tracked_post of meet.platform_specifics.tracked_posts.telegram){
                this.telegram_bot.api.deleteMessage(tracked_post.chat_id, tracked_post.message_id);
            }
        });

        this.meet_manager.on("update_meet", async (meet: Meet)=>{
            await this.update_all_meet_posts(meet);
        });

        this.meet_manager.on("new_meet", async (meet: Meet)=>{
            let current_system_data = this.meet_manager.read_system_data();

            let telegram_chats = current_system_data.telegram.trusted_chat;

            for (let telegram_chat of telegram_chats){

                let message: Message.TextMessage | Message.MediaMessage | undefined = undefined;
                
                switch (telegram_chat.announcements.enabled){
                    case "Channel":
                    case "Chat":{
                        message = await this.send_message(telegram_chat.chat_id, meet, this.get_meet_new_body(meet), meet.attached_meet_media);
                        if (telegram_chat.pin_preference.enabled){
                            await this.telegram_bot.api.pinChatMessage(
                                message.chat.id,
                                message.message_id
                            );
                        }

                        meet.platform_specifics.tracked_posts.telegram.push({
                            chat_id: telegram_chat.chat_id,
                            message_id: message.message_id,
                            type: "groupchat",
                            linked_message: undefined
                        });

                        if (telegram_chat.announcements.enabled == "Channel"){
                            let group_chat_link_name = await this.telegram_bot.api.getChat(telegram_chat.chat_id);
                            let announcement_message;
                            let announcement_chat_id = telegram_chat.announcements.binded_announcement_chat_id!;

                            if (group_chat_link_name.username){
                                announcement_message = await this.send_message(
                                    announcement_chat_id, meet, 
                                    `${this.get_meet_new_body(meet, false)}\n\n` + 
                                    `<i>To find more information on how to participate in this meet, <a href="${`https://t.me/${group_chat_link_name.username}/${message.message_id}`}">press me!</a></i>`,
                                    meet.attached_meet_media, true
                                );
                            }else
                                announcement_message = await this.send_message(
                                    announcement_chat_id, meet, 
                                    `${this.get_meet_new_body(meet, false)}\n\n` + 
                                    `<i>An error has occured creating the link to the meet. Please reconfigure the group chats.</i>`,
                                    meet.attached_meet_media, true
                                );

                            
                            meet.platform_specifics.tracked_posts.telegram.push({
                                chat_id: announcement_chat_id,
                                message_id: announcement_message.message_id,
                                type: "channel",
                                linked_message: {
                                    message_id: message.message_id,
                                    group_chat_username: group_chat_link_name.username!,
                                    chat_id: telegram_chat.chat_id
                                }
                            });
                        }
                        await this.meet_manager.set_meet(meet);

                        break;
                    }
                    case "Disabled":{
                        break;
                    }
                }
            }

        });

        let set_attendee_status = async (context: CallbackQueryContext<Context>, attendance_status: "accepted" | "ride" | "maybe" | "maybenot" | "notinterested" | "declined")=>{
            let meet = (await this.get_meet_from_callback_query(context))!;

            let telegram_attendee = meet.attendance.find(va=>va.user_type == "Telegram" && (va.user as TelegramUser).user_id == context.from.id);

            let success: "Good" | "Bad" | "Error" = "Error";

            if (!telegram_attendee){
                
                meet.attendance.push({
                    user: { 
                        user_id: context.from.id,
                        username: context.from.username,
                        full_name: `${context.from.first_name} ${context.from.last_name}`
                    },
                    user_type: "Telegram",
                    attendance_status: attendance_status
                });
                
                await this.meet_manager.set_meet(meet);
                await this.update_all_meet_posts(meet);
                success = "Good";
            }else{
                if (telegram_attendee.attendance_status != attendance_status){
                    telegram_attendee.attendance_status = attendance_status;
                    await this.meet_manager.set_meet(meet);
                    await this.update_all_meet_posts(meet);
                    success = "Good";
                }else{
                    success = "Bad";
                }
            }

            let contextual_text = "";

            switch(attendance_status){
                case "accepted":{
                    contextual_text = "accepted";
                    break;
                }
                case "ride":{
                    contextual_text = "put up a request for a ride";
                    break;
                }
                case "maybe":{
                    contextual_text = "said maybe";
                    break;
                }
                case "maybenot":{
                    contextual_text = "said maybe not";
                    break;
                }
                case "notinterested":{
                    contextual_text = "said weren't interested";
                    break;
                }
                case "declined":{
                    contextual_text = "declined";
                    break;
                }
            }

            switch(success){
                case "Good":{
                    await context.answerCallbackQuery(`🥳 Yip yip!\n\nYou have ${contextual_text} to this meet!`);
                    break;
                }
                case "Bad":{
                    await context.answerCallbackQuery(`😓 Awwww!\n\nIt appears you already have ${contextual_text} to this meet!`);
                    break;
                }
                case "Bad":{
                    await context.answerCallbackQuery(`🤖 Eof!\n\nAn error has occured trying to reply to this meet...`);
                    break;
                }
            }
        }

        this.telegram_bot.callbackQuery(`posted_meet_coming`, async (context)=>{
            await set_attendee_status(context, "accepted");
        });

        this.telegram_bot.callbackQuery(`posted_meet_ride`, async (context)=>{
            await set_attendee_status(context, "ride");
        });

        this.telegram_bot.callbackQuery(`posted_meet_maybe`, async (context)=>{
            await set_attendee_status(context, "maybe");
        });

        this.telegram_bot.callbackQuery(`posted_meet_maybenot`, async (context)=>{
            await set_attendee_status(context, "maybenot");
        });

        this.telegram_bot.callbackQuery(`posted_meet_notinterested`, async (context)=>{
            await set_attendee_status(context, "notinterested");
        });

        this.telegram_bot.callbackQuery(`posted_meet_notcoming`, async (context)=>{
            await set_attendee_status(context, "declined");
        });

        this.telegram_bot.callbackQuery(`posted_meet_wip`, async (context)=>{
            await context.answerCallbackQuery(`🤖 Sorry!~ This feature is still a WIP. Stay tuned and give the developer moral support uwu :3`);
        });
    }

    async get_meet_from_callback_query(context: CallbackQueryContext<Context>){
        return await this.get_meet_from_message_and_chat_id(context.msgId!, context.chatId!);
    }

    async get_meet_from_message_and_chat_id(message_id: number, chat_id: number){
        let meets = await this.meet_manager.get_meets();

        let matching_meet = meets.find(va=>{
            let matching_message = va.platform_specifics.tracked_posts.telegram.findIndex((va)=>{
                return va.message_id == message_id && va.chat_id == chat_id;
            });

            return matching_message != -1;
        });

        return matching_meet;
    }

    async update_all_meet_posts(meet: Meet){

        let imaged_must_be_updated = meet.platform_specifics.telegram_run_time.cached_file_must_be_updated && 
            meet.platform_specifics.telegram_run_time.is_image_post;

        for (let post of meet.platform_specifics.tracked_posts.telegram){

            try{

                if (imaged_must_be_updated){
                    if (meet.platform_specifics.telegram_run_time.cached_file_must_be_updated){
    
                        let edited_message_media = await this.telegram_bot.api.editMessageMedia(
                            post.chat_id,
                            post.message_id,
                            InputMediaBuilder.photo(new InputFile(meet.attached_meet_media!))
                        ) as (Update.Edited & Message);
    
                        let photos = edited_message_media.photo!;
                        let largest_photo = photos[0]!;
    
                        for (let i = 1;i<photos.length;i++){
                            if (photos[i]!.file_size! > largest_photo.file_size!){
                                largest_photo = photos[i]!;
                            }
                        }
    
                        meet.platform_specifics.telegram_run_time.cached_file_id = largest_photo.file_id
                        meet.platform_specifics.telegram_run_time.cached_file_must_be_updated = false;
    
                        await this.meet_manager.set_meet(meet);
                    }{
                        await this.telegram_bot.api.editMessageMedia(post.chat_id, post.message_id, 
                            InputMediaBuilder.photo(meet.platform_specifics.telegram_run_time.cached_file_id!)
                        );
                    }
                }
                
                switch(post.type){
                    case "channel":{
                        let configuration = {
                            parse_mode: "HTML",
                            link_preview_options: {
                                is_disabled: true
                            },
                        } as {
                            parse_mode: "HTML",
                            reply_markup?: InlineKeyboard
                            link_preview_options: {
                                is_disabled: true,
                            },
                            caption?: string
                        };
    
                        let message_body = "";
    
                        if (post.linked_message!.group_chat_username){
                            message_body =
                                `${this.get_meet_new_body(meet, false)}\n\n` + 
                                `<i>To find more information on how to participate in this meet, <a href="${`https://t.me/${post.linked_message!.group_chat_username}/${post.linked_message!.message_id}`}">press me!</a></i>`;
                        }else
                            message_body =
                                `${this.get_meet_new_body(meet, false)}\n\n` + 
                                `<i>An error has occured creating the link to the meet. Please reconfigure the group chats.</i>`;
    
                        try{
                            if (meet.platform_specifics.telegram_run_time.is_image_post){
                
                                configuration.caption = message_body;
                
                                await this.telegram_bot.api.editMessageCaption(
                                    post.chat_id,
                                    post.message_id,
                                    configuration
                                );
                            }else{
                                await this.telegram_bot.api.editMessageText(
                                    post.chat_id,
                                    post.message_id,
                                    message_body,
                                    configuration
                                );
                            }
                        }
                        catch(er){};
                        break;
                    }
                    case "groupchat":{
                        let configuration = {
                            parse_mode: "HTML",
                            link_preview_options: {
                                is_disabled: true
                            },
                        } as {
                            parse_mode: "HTML",
                            reply_markup?: InlineKeyboard
                            link_preview_options: {
                                is_disabled: true
                            },
                            caption?: string
                        };
    
                        if (meet.meet_date.getTime() > Date.now()){
                            configuration.reply_markup = this.get_meet_new_inline_keyboard(meet);
                        }
    
                        if (meet.platform_specifics.telegram_run_time.is_image_post){
            
                            configuration.caption = this.get_meet_new_body(meet);
            
                            await this.telegram_bot.api.editMessageCaption(
                                post.chat_id,
                                post.message_id,
                                configuration
                            );
                        }else{
                            await this.telegram_bot.api.editMessageText(
                                post.chat_id,
                                post.message_id,
                                this.get_meet_new_body(meet),
                                configuration
                            );
                        }
                        break;
                    }
                }
            }
            catch(er){
                console.error(er);
            };
        }
    }

    get_meet_new_inline_keyboard(meet: Meet){
        let inline_keyboard =  new InlineKeyboard();


        if (meet.meet_date.getTime() > Date.now()){
            inline_keyboard = inline_keyboard   
                .text("✅ Coming", `posted_meet_coming`)
                .text("🚘 Ride needed", `posted_meet_ride`)
                .row()
                .text("🤔 Maybe", `posted_meet_maybe`)
                .text("😔 Maybe no", `posted_meet_maybenot`)
                .row()
                .text("❌ Not coming", `posted_meet_notcoming`)
                .text("💔 Not interested", `posted_meet_notinterested`)
                .row()
                .text("🔔 Notify me", "posted_meet_wip")//`t.me/${this.telegram_handler.get_me_username()}?start=configure_meet_notifications_${meet.meet_id}`)
                .url("🗺️ Directions", (()=>{
                    let { meet_location } = meet;

                    if (meet_location.location.latitude && meet_location.location.longitude){
                        return `https://www.google.com/maps/search/?api=1&query=${meet_location.location.latitude}%2C${meet_location.location.longitude}`;
                    }else{
                        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meet_location.name)}`;
                    }
                })())
                .row()
                .text("📅 Add to Calendar", `posted_meet_wip`)
                .row();
        }

        return inline_keyboard.url("🔧 Manage Meet", `t.me/${this.telegram_handler.get_me_username()}?start=configure_meet_${meet.meet_id}`);
    }

    get_meet_new_body(meet: Meet, can_be_auto_updated = true){

        let truncate = (str: string)=>{
            if (str.length >= 17){
                return `${str.substring(0, 17)}...`;
            }else{
                return str;
            }
        }
// ✅
// 🚘
// 👋
// ❌
        let random_char = createHash("sha256").update(meet.meet_name).digest("binary").charCodeAt(0);

        let random_byte = random_char % 11; 

        let random_icon = [
            "🐶", "🦊", "🐱", "🦊", "🐺", "🐯", "🫎", "🐻", "🦇", "🐼", "🦅"
        ][random_byte];

        return `${random_icon} <b><u>${meet.meet_name}</u></b>\n` +
            `On <b>${format_date(meet.meet_date)}</b>${(()=>{
                if (meet.meet_date.getTime() < Date.now()){
                    return "\n<b><u>Note: This meet has concluded and will no longer happen. You cannot mark whether you want to participate or not at this point. ;-;</u></b>";
                }else{
                    return "";
                }
            })()}\n` + 
            `At <b><a href="${(()=>{
                let { meet_location } = meet;

                if (meet_location.location.latitude && meet_location.location.longitude){
                    return `https://www.google.com/maps/search/?api=1&query=${meet_location.location.latitude}%2C${meet_location.location.longitude}`;
                }else{
                    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meet_location.name)}`;
                }
            })()}">${meet.meet_location.name}</a></b>\n` + 
            `Hosted by ${(()=>{
                let hosted_links = [];

                if (meet.planner.telegram){
                    hosted_links.push(`@${meet.planner.telegram}`);
                }
                
                return hosted_links.join(",");
            })()}\n\n` +
            `<i>${meet.meet_description}</i>\n\n` + 
            `${can_be_auto_updated ? (()=>{
                let text_attendance_list = {
                    accepted: [] as string[],
                    need_car: [] as string[],
                    maybe: [] as string[],
                    maybe_not: [] as string[],
                    not_interested: [] as string[],
                    declined: [] as string[],
                }

                let attendance_list = meet.attendance.sort((a, b)=>{
                    return (a.user.username || "").localeCompare(b .user.username|| "");
                });

                // <a href="https://discord.com/users/317118157711998976/">thejades</a>

                for (let attendee of attendance_list){
                    let list: string[];
                    switch(attendee.attendance_status){
                        case "accepted":{
                            list = text_attendance_list.accepted;
                            break;
                        }
                        case "ride":{
                            list = text_attendance_list.need_car;
                            break;
                        }
                        case "maybe":{
                            list = text_attendance_list.maybe;
                            break;
                        }
                        case "maybenot":{
                            list = text_attendance_list.maybe_not;
                            break;
                        }
                        case "notinterested":{
                            list = text_attendance_list.not_interested;
                            break;
                        }
                        case "declined":{
                            list = text_attendance_list.declined;
                            break;
                        }
                    }

                    if (attendee.user_type == "Telegram"){
                        let telegram_user = attendee.user as TelegramUser;
                        list.push(`<a href="tg://user?id=${telegram_user.user_id}">@${telegram_user.username || truncate(telegram_user.full_name)}</a>`);
                    }else{
                        let discord_user = attendee.user as DiscordUser;
                        list.push(`<a href="https://discord.com/users/${discord_user.snowflake_id}">@${discord_user.username}</a>`);
                    }
                }

                let attendance_text = "";

                if (text_attendance_list.accepted.length > 0){
                    attendance_text += `✅ Attendees (#${text_attendance_list.accepted.length}): ${text_attendance_list.accepted.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                if (text_attendance_list.need_car.length > 0){
                    attendance_text += `🚘 Need a ride (#${text_attendance_list.need_car.length}): ${text_attendance_list.need_car.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                if (text_attendance_list.maybe.length > 0){
                    attendance_text += `🤔 Maybe (#${text_attendance_list.maybe.length}): ${text_attendance_list.maybe.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                if (text_attendance_list.maybe_not.length > 0){
                    attendance_text += `😔 Maybe not (#${text_attendance_list.maybe_not.length}): ${text_attendance_list.maybe_not.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                if (text_attendance_list.not_interested.length > 0){
                    attendance_text += `💔 Not interested (#${text_attendance_list.not_interested.length}): ${text_attendance_list.not_interested.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                if (text_attendance_list.declined.length > 0){
                    attendance_text += `❌ Cannot come (#${text_attendance_list.declined.length}): ${text_attendance_list.declined.join(", ")}\n`;
                }else{
                    attendance_text += "";
                }

                return attendance_text;
            })() : ""}\n` +
            // Might cause an issue if the person repewats it again
            `<i>Last updated: ${format_date(new Date())}</i>`;
    }
}

export class TelegramHandler{

    private telegram_bot;
    private telegram_username = "";
    private meet_manager;
    private telegram_bot_token: string;

    private configurator_chat_extra_context = new Map<number, Context>(); 

    public constructor(telegram_bot_token: string, meet_manager: MeetManager){
        this.telegram_bot = new Bot(telegram_bot_token);
        this.meet_manager = meet_manager;
        this.telegram_bot_token = telegram_bot_token;

        this.telegram_bot.catch((error)=>{
            console.error(`Telegram Bot has experienced a fault: ${error.message}`);
            console.warn(`The fault is located at ${error.stack}`);
        });
    }

    get_me_username(){
        return this.telegram_username;
    }

    public async attempt_sign_in(){
        console.log("Logging into Telegram Bot...");
        this.telegram_username = (await this.telegram_bot.api.getMe()).username;
        await this.initialize_client();

        this.telegram_bot.start();
    
        console.log("Logged into Telegram Bot!");
    }

    private get_command_match(context: Context): {command: string, rest: string} | undefined{
        return (context as any).commandMatch;
    }

    async chat_check_permission_state(context: Context){

        let chat = context.chat;
        let message = context.message;
        let user = context.from;

        if (!chat || !message || !user || chat.type == "private")
            return {
                administrator: false,
                type: "private" as "private"
            };
            
        let chat_member = await this.telegram_bot.api.getChatMember(chat.id, user.id);


        return {
            administrator: chat_member.status == "creator" || chat_member.status == "administrator",
            type: chat.type
        }
    }

    async global_check_permission(context: Context){
        let user = context.from;

        if (!user)
            return {
                is_administrator: false,
                is_member: false,
                belonging_chat_id: undefined
            };

        let current_system_data = this.meet_manager.read_system_data();
        
        let is_administrator = false;
        let is_member = false;
        let belonging_chat_id: number | undefined;
    
        for (let chat of current_system_data.telegram.trusted_chat){
            let chat_member = await this.telegram_bot.api.getChatMember(chat.chat_id, user.id);

            switch(chat_member.status){
                case "creator":{
                    is_administrator = true;
                }
                case "administrator":{
                    is_administrator = true;
                }
                case "member": {
                    is_member = true;
                    break;
                }
            }

            if (is_member){
                belonging_chat_id = chat.chat_id;
                break;
            }
        }

        return {
            is_administrator,
            is_member,
            belonging_chat_id
        }
    }

    async download_telegram_image(image_file: File){
        return new Promise<Buffer>((accept, reject)=>{
            get(`https://api.telegram.org/file/bot${this.telegram_bot_token}/${image_file.file_path}`, (response)=>{
                let content_size = Number(response.headers["content-length"]);
                let image_buffer = Buffer.alloc(content_size);

                let write_header = 0;

                response.on("data", (chunk: Buffer)=>{
                    image_buffer.write(chunk.toString("binary"), write_header, "binary");
                    write_header += chunk.byteLength;
                });

                response.on("close", ()=>{
                    accept(image_buffer);
                });
            });
        });
    }

    private async initialize_client(){

        let commands = new CommandGroup();

        let furmeet_menu_creator = new FurmeetCreation_GenMenu(this.telegram_bot, this, this.meet_manager);
        let furmeet_menu_manager = new FurmeetManager_GenMenu(this.telegram_bot, this, this.meet_manager);
        let chat_configurator_menu_creator = new ChatConfigurator_Menu(this.telegram_bot, this, this.meet_manager);
        let furmeet_posted_manager = new Furmeet_PostManager(this.telegram_bot, this, this.meet_manager);


        commands.command("start", "Start Command", async (context)=>{
            let command_match = this.get_command_match(context);

            let user = context.from;
            
            if (context.message?.chat.type != "private")
                return;

            if (!user || !command_match)
                return;

            let command_components = command_match.rest.match(/(?<Command>[A-Za-z]+(?:_[A-Za-z]+)*)(?:_(?<Id>\d+))?/)!;

            let command = command_components.groups!.Command;
            let id = command_components.groups!.Id;

            switch(command){
                case "configure_meet":{
                    let global_permission = await this.global_check_permission(context);
        
                    if (!global_permission.is_member)
                        return context.reply(`You do not belong to a chat that is trusted by this bot. You cannot run this command.`, {
                            protect_content: true,
                            parse_mode: "HTML"
                        });

                    let meet = await this.meet_manager.get_meet(Number(id!));
                    let { platform_specifics } = meet;

                    if (platform_specifics.platform == "Telegram" && (
                        (platform_specifics.username as TelegramUser).user_id == context.from?.id ||
                        global_permission.is_administrator
                    )){
                        await furmeet_menu_manager.menu_generate(context, meet);
                    }else{

                        let truncate = (str: string)=>{
                            if (str.length >= 17){
                                return `${str.substring(0, 17)}...`;
                            }else{
                                return str;
                            }
                        }

                        // TODO: change this nonsense to something to senseical. fuck this huge lin shit

                        return context.reply(`You cannot change this meet as you are not the one originally posting this one.\n` +
                            meet.platform_specifics.platform == "Telegram" ? 
                                `Perhaps contact <a href="tg://user?id=${(meet.platform_specifics.username as TelegramUser).user_id}">@${(meet.platform_specifics.username as TelegramUser).username || truncate((meet.platform_specifics.username as TelegramUser).full_name)}</a>` : "", {
                            protect_content: true,
                            parse_mode: "HTML"
                        });
                    }
        
                    break;
                }
                case "configure_chat":{
                    let previous_context = this.configurator_chat_extra_context.get(user.id);

                    if (!previous_context){
                        return context.reply(
                            `This command has failed.\nThe chat you were redirected from did not carry over its context. You most likely didn't run the command`,{
                                protect_content: true
                            });
                    }

                    let permission_state = await this.chat_check_permission_state(previous_context);

                    if (permission_state.administrator){

                        let meet_manager = this.meet_manager;
                        let current_system_data = meet_manager.read_system_data();

                        let chat_id = previous_context.chat!.id;

                        let chat_configuration = current_system_data.telegram.trusted_chat.find((va)=>{
                            return va.chat_id == chat_id;
                        });

                        if (chat_configuration){
                            await chat_configurator_menu_creator.menu_generate(context, chat_configuration);
                        }else{
                        return context.reply(
                            `This command has failed.\nThe chat that you are configurating doesn't exist or isn't trusted.`,{
                                protect_content: true
                            });
                        }

                    }

                    break;
                }
                case "create_furmeet":{
                    let global_permission = await this.global_check_permission(context);
        
                    if (!global_permission.is_member)
                        return context.reply(`You do not belong to a chat that is trusted by this bot. You cannot run this command.`, {
                            protect_content: true,
                            parse_mode: "HTML"
                        });
        
                    await furmeet_menu_creator.menu_generate(context);
                    break;
                }
            }
        });

        let furmeet_redirect_menu = new Menu("furmeet_redirect_button")
            .url("Start in my DMs", `t.me/${this.telegram_username}?start=create_furmeet`);

        this.telegram_bot.use(furmeet_redirect_menu);

        commands.command("create_furmeet", "Start the Furmeet Creation process. (Must be ran in DMs)", async (context)=>{
            let global_permission = await this.global_check_permission(context);
            
            if (!global_permission.is_member)
                return context.reply(`You do not belong to a chat that is trusted by this bot. You cannot run this command.`, {
                    protect_content: true,
                    parse_mode: "HTML"
                });

            if (context.chat.type != "private"){
                context.reply(`To continue please start me in a DM using the button below!`,{
                    protect_content: true,
                    reply_markup: furmeet_redirect_menu
                });
            }else{

                await furmeet_menu_creator.menu_generate(context);
            }
        });

        commands.command("authorize_chat", "Authorize the chat so all of the bot's features can be used here. Requires OTP", async (context)=>{
            let command_match = this.get_command_match(context);
            let permission_state = await this.chat_check_permission_state(context);

            if (permission_state.administrator){
                let current_system_data = this.meet_manager.read_system_data();

                let index = current_system_data.telegram.trusted_chat.findIndex(va=>context.chatId == va.chat_id);

                if (index == -1){

                    let otp_generator = this.meet_manager.get_otp_generator();

                    if (!otp_generator.verify_one_time_password(command_match?.rest || "")){
                        context.reply("This chat cannot be <b>authorized</b>! The OTP is wrong and the bot maintainer has been warned.", {
                            protect_content: true,
                            parse_mode: "HTML"
                        });
                        return;
                    }

                    current_system_data.telegram.trusted_chat.push({
                        chat_id: context.chatId,
                        announcements: {
                            enabled: "Chat",
                            binded_announcement_chat_id: undefined
                        },
                        pin_preference: {
                            enabled: false,
                            expirey_period: "1 day",
                            unpin_after_expirey: true
                        }
                    });

                    await this.meet_manager.save_system_data();

                    context.reply("This chat has been <b>authorized</b>! This chat is trusted and can now run most commands.", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }else{
                    context.reply("This chat is already <b>authorized</b>!", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }
            }else{
                if (permission_state.type == "private"){
                    context.reply("This command cannot be run in a <b>private chat!</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }else{
                    context.reply("You do not have permission to run this command <b>Authorize Chat</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }
            }
        });

        commands.command("deauthorize_chat", "Deauthorize the chat.", async (context)=>{
            let permission_state = await this.chat_check_permission_state(context);

            if (permission_state.administrator){
                let current_system_data = this.meet_manager.read_system_data();

                let index = current_system_data.telegram.trusted_chat.findIndex(va=>context.chatId == va.chat_id);

                if (index != -1){

                    current_system_data.telegram.trusted_chat.splice(index, 1);

                    await this.meet_manager.save_system_data();

                    context.reply("This chat has been <b>deauthorized</b>! This chat is untrusted and cannot run most commands without being trusted.", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }else{
                    context.reply("This chat is already <b>deauthorized</b>!", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }
            }else{
                if (permission_state.type == "private"){
                    context.reply("This command cannot be run in a <b>private chat!</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }else{
                    context.reply("You do not have permission to run this command <b>Deauthorize Chat</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }
            }
        });

        let chatconfigurator_redirect_menu = new Menu("chatconfigurator_redirect_button")
            .url("Start in my DMs", `t.me/${this.get_me_username()}?start=configure_chat`);

        this.telegram_bot.use(chatconfigurator_redirect_menu);

        commands.command("configure_chat", "Configures the chat.", async (context)=>{
            let permission_state = await this.chat_check_permission_state(context);

            let user = context.from;

            if (!user)
                return;

            if (permission_state.administrator){
                context.reply(`You can press this button to configure this chat in my DMs~! Only the person that ran this command can interact with me.`,{
                    protect_content: true,
                    reply_markup: chatconfigurator_redirect_menu
                });

                this.configurator_chat_extra_context.set(user.id, context);
            }else{
                if (permission_state.type == "private"){
                    context.reply("This command cannot be run in a <b>private chat!</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }else{
                    context.reply("You do not have permission to run this command <b>Deauthorize Chat</b>", {
                        protect_content: true,
                        parse_mode: "HTML"
                    });
                }
            }
        });

        commands.command("get_upcoming_meets", "Fetches upcoming meets and tells you what they are.", async (context)=>{
            let global_permission = await this.global_check_permission(context);
            
            if (!global_permission.is_member)
                return context.reply(`You do not belong to a chat that is trusted by this bot. You cannot run this command.`, {
                    protect_content: true,
                    parse_mode: "HTML"
                });

            let meets = await this.meet_manager.get_meets();

            meets.sort((a, b)=>a.meet_date.getTime() - b.meet_date.getTime());
            
            let chat_id = context.chat.id;
            let chat = await (async ()=>{
                if (context.chat.type == "private"){
                    return await this.telegram_bot.api.getChat(chat_id = global_permission.belonging_chat_id!)
                }else{
                    return await this.telegram_bot.api.getChat(chat_id = context.chat.id);
                }
            })();

            let meet_str: string[] = [];
            let unsupported = true;

            for (let meet of meets){
                if (meet.meet_date.getTime() > Date.now() && meet.meet_disabled == false){

                    let random_char = createHash("sha256").update(meet.meet_name).digest("binary").charCodeAt(0);

                    let random_byte = random_char % 11; 

                    let random_icon = [
                        "🐶", "🦊", "🐱", "🦊", "🐺", "🐯", "🫎", "🐻", "🦇", "🐼", "🦅"
                    ][random_byte];

                    let relevant_message: {
                        message_id: number;
                        chat_id: number;
                        linked_message: {
                            message_id: number;
                            chat_id: number;
                            group_chat_username: string;
                        } | undefined;
                        type: "channel" | "groupchat";
                    } | undefined = undefined;

                    for (let tracked_post of meet.platform_specifics.tracked_posts.telegram){
                        if (tracked_post.chat_id == chat_id){
                            relevant_message = tracked_post;
                            break;
                        }
                    }

                    if (relevant_message && chat.username){
                        unsupported = false;
                        meet_str.push(`<a href="t.me/${chat.username!}/${relevant_message.message_id}">${random_icon} <u>${meet.meet_name}</u> on ${format_date(meet.meet_date)}</a>`);
                    }else{
                        meet_str.push(`<u>${meet.meet_name}</u> on ${format_date(meet.meet_date)}`);
                    }
                    
                }
            }

            context.reply(
                `<b>Here are the upcoming meets!</b>\n\n${unsupported ? "This groupchat does not support links because it is not a superchat. Please run me in DMs or a superchat to get links to these meets.\n\n" : ""}` + 
                meet_str.join("\n"),
            {
                link_preview_options: {
                    is_disabled: true
                },
                parse_mode: "HTML"
            });
        });

        // commands.command("ban_telegram_user", "Blocks the telegram user by the username from using this bot.", async (context)=>{
        // });

        // commands.command("unban_telegram_user", "Unblocks the telegram user by the username from using this bot.", async (context)=>{
        // });

        // commands.command("bruh", "don't run this.", async (context)=>{
        //     context.reply("<a href=\"tg://user?id=6178647975\">me</a>" + 
        //         "<a href=\"https://jades.dev/images/kades.png\"> </a>\n" +
        //         "https://www.google.com/maps/search/?api=1&query=51.052769%2C-114.069098", {
        //         parse_mode: "HTML"
        //     })
        // });

        // commands.command("shit", "absolutely don't", async (context)=>{
        //     context.replyWithPhoto("https://jades.dev/images/kades.png", {
        //         caption: "shit"
        //     })
        // });

        // commands.command("fuck", "you", async (context)=>{
        //     context.reply("<a href=\"data:text/txt;base64,ZQo=\">TEXT</a>" + 
        //         "<a href=\"https://jades.dev/images/kades.png\"> </a>\n" +
        //         "https://www.google.com/maps/search/?api=1&query=51.052769%2C-114.069098", {
        //         parse_mode: "HTML"
        //     })
        // });

        this.telegram_bot.on("message:forward_origin", (context: Context)=>{
            if (!context.message || !context.message.forward_origin)
                return;

            // TODO: handle forwaded messages with multiple images

            if (!context.message.caption && !context.message.text){
                return;
            }

            furmeet_menu_creator.on_general_message_event(context);
            furmeet_menu_manager.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);

        });

        this.telegram_bot.on("message", (context: Context, next)=>{
            if (!context.message || context.message.forward_origin)
                return;

            furmeet_menu_creator.on_general_message_event(context);
            furmeet_menu_manager.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);

            next();
        });

        this.telegram_bot.on("channel_post", async (context)=>{
            if (!context.channelPost)
                return;

            furmeet_menu_creator.on_general_message_event(context);
            furmeet_menu_manager.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);
        });
        

        this.telegram_bot.use(commands);
        await commands.setCommands(this.telegram_bot);
    }
}
