import * as console from "../consolescript.js";
import { Bot, Context, InlineKeyboard, type CallbackQueryContext } from "grammy";
import { Menu } from "@grammyjs/menu";
import type { Message } from "grammy/types";
import { CommandGroup } from "@grammyjs/commands";
import { get } from "https";
import { MeetManager, type ChatConfiguration, type Meet } from "../utils/meet_manager.js";

type TelegramUserStateMachine = {
    initialized_message: Message
}

type TelegramUser = {
    user_id: number;
    username: string;
}

type FurmeetCreation_UserStates = "IntroMenu" | "MainMenu" | "MeetName" | "MeetLocation" | "MeetDate" | "MeetPlanner" | "MeetDescription" | "MeetMedia" | "Cancelled" | "LastConfirm" | "Confirmed";

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
                        return "⚙️ Broadcast to [Channel]";
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
                        chat_configuration.announcements.enabled = "Channel";
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

                if (i == 0){
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
                    attached_meet_media: undefined
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
                    `<b>Meet Date:</b> <u>${user_state_machine.meet_date.toLocaleString()}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    `<i><u>Hint: You can forward me the message the planner sent and I can autofill most details!</u></i>`;
            }
            case "MainMenu":{
                return `You are creating a meet in which we will be announced to everyone.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${user_state_machine.meet_date.toLocaleString()}</u>\n` +
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
                    `Currently, the meet is on <u>${`${user_state_machine.meet_date.toLocaleString()}`}</u>.\n` +
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
                return `You are changing the <b>Meet Media</b>.\n\n` + 
                    `There is no uploaded media.\n` +
                    `To change it, upload a media in the chat or press the <b>Edit Meet Media</b> button.`;
            }
            case "Cancelled":{
                return `You cancelled creating this furmeet. You are free to start this process whenevever you want.`
            }
            case "LastConfirm":{

                let warnings = "";

                if (user_state_machine.meet_date.getTime() < Date.now()){
                    warnings += "⚠️ This meet has happened in the past and will not be tracked and announced. Please return back and fix this! ⚠️\n";
                }

                return `<b>Please confirm the details before submitting. You cannot edit this meet once submitted!</b>.\n\n` + 
                    `<b>Meet Name:</b> <u>${user_state_machine.meet_name}</u>\n` +
                    `<b>Meet Date:</b> <u>${user_state_machine.meet_date.toLocaleString()}</u>\n` +
                    `<b>Meet Location:</b> <u>${user_state_machine.meet_location.name}</u>\n` +
                    `<b>Organizer:</b> <u>@${user_state_machine.planner_contact.telegram_username || "Unknown"}</u>\n` +
                    `<i>${user_state_machine.meet_description}</i>\n\n\n` +
                    (warnings ? `<i><u>${warnings}</u></i>` : "");
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
                        `This location cannot be looked up from its name and therefore map context features cannot be used. Please use the location picker and try again.`
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

    private static inlineKeyboard = new InlineKeyboard()
        .text("✅ Coming!", `posted_meet_coming`)
        .text("❌ Cannot come", `posted_meet_notcoming`)


    constructor(telegram_bot: Bot, telegram_handler: TelegramHandler, meet_manager: MeetManager){
        this.telegram_bot = telegram_bot;
        this.telegram_handler = telegram_handler;
        this.meet_manager = meet_manager;

        this.meet_manager.on("new_meet", async (meet: Meet)=>{
            let current_system_data = this.meet_manager.read_system_data();

            let telegram_chats = current_system_data.telegram.trusted_chat;

            for (let telegram_chat of telegram_chats){

                

                let message: Message.TextMessage | undefined = undefined;
                
                switch (telegram_chat.announcements.enabled){
                    case "Chat":{
                        message = 
                            await this.telegram_bot.api.sendMessage(
                                telegram_chat.chat_id, 
                                this.get_meet_new_body(meet),
                            {
                                parse_mode: "HTML",
                                reply_markup: Furmeet_PostManager.inlineKeyboard,
                                link_preview_options: {
                                    is_disabled: true
                                },
                                protect_content: true
                            });

                            if (telegram_chat.pin_preference.enabled){
                                await this.telegram_bot.api.pinChatMessage(
                                    message.chat.id,
                                    message.message_id
                                );
                            }
                        break;
                    }
                    case "Channel":{
                        message = 
                            await this.telegram_bot.api.sendMessage(
                                telegram_chat.announcements.binded_announcement_chat_id!, 
                                this.get_meet_new_body(meet),
                            {
                                parse_mode: "HTML",
                                reply_markup: Furmeet_PostManager.inlineKeyboard,
                                link_preview_options: {
                                    is_disabled: true
                                },
                                protect_content: true
                            });
                        break;
                    }
                    case "Disabled":{
                        break;
                    }
                }

                if (message){
                    meet.platform_specifics.tracked_posts.telegram.push({
                        chat_id: telegram_chat.chat_id,
                        message_id: message.message_id
                    });
                    await this.meet_manager.set_meet(meet);
                }
            }

        });

        this.telegram_bot.callbackQuery(`posted_meet_coming`, async (context)=>{

            let meet = (await this.get_meet_from_callback_query(context))!;
            {
                let telegram_user_index = meet.nonattendees.telegram.findIndex(va=>va.user_id == context.from.id);

                if (telegram_user_index != -1){
                    
                    meet.nonattendees.telegram.splice(telegram_user_index, 1);
                    
                    await this.meet_manager.set_meet(meet);
                }
            }

            let telegram_user_index = meet.attendees.telegram.findIndex(va=>va.user_id == context.from.id);

            if (telegram_user_index == -1){
                
                meet.attendees.telegram.push({
                    user_id: context.from.id,
                    username: context.from.username,
                    full_name: `${context.from.first_name} ${context.from.last_name}`
                });
                
                await this.meet_manager.set_meet(meet);
                await this.update_all_meet_posts(meet);
            }else{
                await context.answerCallbackQuery("You already have said you are not coming. You cannot come again.");
            }
        });

        this.telegram_bot.callbackQuery(`posted_meet_notcoming`, async (context)=>{

            // i know this looks like shit, but trust me it works bro
            let meet = (await this.get_meet_from_callback_query(context))!;
            {
                let telegram_user_index = meet.attendees.telegram.findIndex(va=>va.user_id == context.from.id);

                if (telegram_user_index != -1){
                    
                    meet.attendees.telegram.splice(telegram_user_index, 1);
                    
                    await this.meet_manager.set_meet(meet);
                }
            }

            let telegram_user_index = meet.nonattendees.telegram.findIndex(va=>va.user_id == context.from.id);

            if (telegram_user_index == -1){
                
                meet.nonattendees.telegram.push({
                    user_id: context.from.id,
                    username: context.from.username,
                    full_name: `${context.from.first_name} ${context.from.last_name}`
                });
                
                await this.meet_manager.set_meet(meet);
                await this.update_all_meet_posts(meet);
            }else{
                await context.answerCallbackQuery("You already have said you are not coming. You cannot come again.");
            }
        });

        this.telegram_bot.callbackQuery(`posted_meet_dm`, async (context)=>{

            let meet = await this.get_meet_from_callback_query(context);

            console.log(meet);
            await context.answerCallbackQuery("Sent you the planner's contact details to your DMs! Please check there!");
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
        for (let post of meet.platform_specifics.tracked_posts.telegram){
            await this.telegram_bot.api.editMessageText(
                post.chat_id,
                post.message_id,
                this.get_meet_new_body(meet),
                {
                    parse_mode: "HTML",
                    reply_markup: Furmeet_PostManager.inlineKeyboard,
                    link_preview_options: {
                        is_disabled: true
                    },
                }
            )
        }
    }

    get_meet_new_body(meet: Meet){

        let truncate = (str: string)=>{
            if (str.length >= 17){
                return `${str.substring(0, 17)}...`;
            }else{
                return str;
            }
        }

        return `<b><u>${meet.meet_name}</u></b>\n` +
            `On <b>${meet.meet_date.toLocaleString()}</b>\n` + 
            `At <b><a href="https://www.google.com/maps/search/?api=1&query=${meet.meet_location.location.latitude}%2C${meet.meet_location.location.longitude}">${meet.meet_location.name}</a></b>\n` + 
            `Hosted by ${(()=>{
                let hosted_links = [];

                if (meet.planner.telegram){
                    hosted_links.push(`@${meet.planner.telegram}`);
                }
                
                return hosted_links.join(",");
            })()}\n\n` +
            `<i>${meet.meet_description}</i>\n\n` + 
            `${(()=>{
                let attendee_list = [];

                // <a href="https://discord.com/users/317118157711998976/">thejades</a>

                for (let attendee of meet.attendees.telegram){
                    if (attendee.username){
                        attendee_list.push(`<a href="tg://user?id=${attendee.user_id}">@${attendee.username}</a>`);
                    }else{
                        attendee_list.push(`<a href="tg://user?id=${attendee.user_id}">${truncate(attendee.full_name)}</a>`);
                    }
                }

                if (attendee_list.length > 0){
                    return `Attendees (#${attendee_list.length}): ${attendee_list.join(", ")}\n`;
                }else{
                    return "";
                }
            })()}` +
            `${(()=>{
                let nonattendee_list = [];

                // <a href="https://discord.com/users/317118157711998976/">thejades</a>

                for (let attendee of meet.nonattendees.telegram){
                    if (attendee.username){
                        nonattendee_list.push(`<a href="tg://user?id=${attendee.user_id}">@${attendee.username}</a>`);
                    }else{
                        nonattendee_list.push(`<a href="tg://user?id=${attendee.user_id}">${truncate(attendee.full_name)}</a>`);
                    }
                }

                if (nonattendee_list.length > 0){
                    return `Not Attendees (#${nonattendee_list.length}): ${nonattendee_list.join(", ")}\n`
                }else{
                    return "";
                }
            })()}`;
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
                is_member: false
            };

        let current_system_data = this.meet_manager.read_system_data();
        
        let is_administrator = false;
        let is_member = false;
    
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

            if (is_member)
                break;
        }

        return {
            is_administrator,
            is_member
        }
    }

    private async initialize_client(){

        let commands = new CommandGroup();

        let furmeet_menu_creator = new FurmeetCreation_GenMenu(this.telegram_bot, this, this.meet_manager);
        let chat_configurator_menu_creator = new ChatConfigurator_Menu(this.telegram_bot, this, this.meet_manager);
        let furmeet_posted_manager = new Furmeet_PostManager(this.telegram_bot, this, this.meet_manager);


        commands.command("start", "Start Command", async (context)=>{
            let command_match = this.get_command_match(context);

            let user = context.from;

            if (!user)
                return;

            switch(command_match?.rest){
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
            .url("Start in my DMs", `t.me/${this.telegram_username}?start=configure_chat`);

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

        commands.command("ban_telegram_user", "Blocks the telegram user by the username from using this bot.", async (context)=>{
        });

        commands.command("unban_telegram_user", "Unblocks the telegram user by the username from using this bot.", async (context)=>{
        });

        commands.command("bruh", "don't run this.", async (context)=>{
            context.reply("<a href=\"tg://user?id=6178647975\">me</a>", {
                parse_mode: "HTML"
            })
        });

        this.telegram_bot.on("message:forward_origin", (context: Context)=>{
            if (!context.message || !context.message.forward_origin)
                return;

            // TODO: handle forwaded messages with multiple images

            if (!context.message.caption && !context.message.text){
                return;
            }

            furmeet_menu_creator.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);

        });

        this.telegram_bot.on("message", (context: Context, next)=>{
            if (!context.message || context.message.forward_origin)
                return;

            furmeet_menu_creator.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);

            next();
        });

        this.telegram_bot.on("channel_post", async (context)=>{
            if (!context.channelPost)
                return;

            furmeet_menu_creator.on_general_message_event(context);
            chat_configurator_menu_creator.on_general_message_event(context);
        });
        

        this.telegram_bot.use(commands);
        await commands.setCommands(this.telegram_bot);
    }
}
