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

import { AttachmentBuilder, ChatInputCommandInteraction, Client, Collection, Embed, EmbedBuilder, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder, SlashCommandStringOption, type RESTPostAPIChatInputApplicationCommandsJSONBody, type SlashCommandOptionsOnlyBuilder } from "discord.js";
import { Bot, Context, type CommandContext } from "grammy";
import { LowLevelJadeDB } from "./modules/jadestores.js";
import { JadeStruct } from "./modules/jadestruct.js";
import * as console from "./modules/consolescript.js";
import { get } from "https";
import { writeFile } from "fs/promises";

const telegram_bot_api_key = "";
const discord_bot_api_key = "";
const client_id = "";

const telegram_bot = new Bot(telegram_bot_api_key);
const discord_bot = new Client({intents: [GatewayIntentBits.Guilds]});

let user_context_broadcast_set = false;
let user_context_broadcast_origin_message: CommandContext<Context> | undefined = undefined;

const rest = new REST().setToken(discord_bot_api_key);

type Meet = {
    planned_date: Date,
    planner: string,
    pinner: string,
    message_id: number,
    chat_id: number,
    meet_name: string,
    meet_info: string,
    attached_meet_media: Buffer | undefined
}

(async ()=>{

    let database = new LowLevelJadeDB("./database.db", 4096);

    await database.open();

    let system_data = {
        broadcast_channel_id: 0,
        main_group_chat_id: 0,
        number_of_events: 0,
        authorized_usernames: [] as string[]
    };

    if (!await database.exists(0)){
        console.warn("Generated new system data session due to no pre-existing one! ^-^");
        await database.writeData(JadeStruct.toJadeStruct(system_data).convertToNodeJSBuffer(), 0, "SystemData", 0);
    }else{
        console.log("Managed to retrieve previous system data session! ^-^");
        system_data = JadeStruct.toObject((await database.readData(0)).Buffer);
    }

    console.log(system_data);

    async function save_system_data(){
        await database.writeData(JadeStruct.toJadeStruct(system_data).convertToNodeJSBuffer(), 0, "SystemData", 0);
    }

    async function set_broadcast_channel(chat_id: number){
        system_data.broadcast_channel_id = chat_id;
        await save_system_data();
    }

    async function set_main_group_chat(chat_id: number){
        system_data.main_group_chat_id = chat_id;
        await save_system_data();
    }

    function get_broadcast_channel(){
        return system_data.broadcast_channel_id;
    }

    function get_main_group_chat_id(){
        return system_data.main_group_chat_id;
    }
    
    let one_time_code = "";

    function generate_one_time_code(){
        one_time_code = "";

        for (let i = 0;i<20;i++){
            one_time_code += String(Math.floor(Math.random() * 10))
        }

        console.log(`Your one time code is generated here: ${one_time_code}. You can use this to change the main group chat.`);
    }

    generate_one_time_code();

    async function determine_administrator_role(user_id: number, chat_id: number){
        if (chat_id == 0){
            return;
        }
        let chat_administrators = await telegram_bot.api.getChatAdministrators(chat_id);

        let administrator_profile = chat_administrators.find((user)=>{
            return user.user.id == user_id;
        });

        return administrator_profile;
    }

    await telegram_bot.api.setMyCommands([
        {command: "pin", description: "Pins the furmeet information to the channel. >_<"},
        {command: "get_upcoming_meets", description: "Get upcoming furmeets!~"},
        {command: "set_broadcast_channel", description: "Admin Command for setting the broadcasting channel for telegram"},
        {command: "set_main_group_chat", description: "Admin Command for setting the main group chat for telegram"},
        {command: "authorize_pin", description: "Admin Command for authorizing a user to pin stuff! You can specify the username as a parameter!"},
        {command: "deauthorize_pin", description: "Admin Command for deauthorizing a user to pin stuff! You can specify the username as a parameter!"},
    ]);


    type PinContext = "Forwarding" | "NameInput" | "Editing" | "Unknown" | "EditingDate" | "EditingName" | "Done";

    let user_pin_contexts = new Map<number, {
        context: PinContext,
        forwarded_meet_info: Meet | undefined
    }>();

    function start_pin_process(instigator_id: number){
        user_pin_contexts.set(instigator_id, {
            context: "Forwarding",
            forwarded_meet_info: undefined
        });
    }

    function get_current_pin_process(instigator_id: number){
        return user_pin_contexts.get(instigator_id) || {
            context: "Unknown", 
            forwarded_meet_info: undefined
        };
    }

    function permit_delay(delay_ms: number){
        return new Promise<void>((accept, reject)=>{
            setTimeout(()=>{
                accept();
            }, delay_ms);
        });
    }

    function download_image(image_url: string){
        return new Promise<Buffer>((accept, reject)=>{
            get(image_url, (response)=>{
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
            });;
        });
    }


    telegram_bot.command("set_broadcast_channel", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        if (!message){
            return;
        }

        let instigator_id = message.from.id;

        if (chat.type == "group" || chat.type == "supergroup"){
            let administrator_profile = await determine_administrator_role(instigator_id, get_main_group_chat_id());
    
            if (administrator_profile){
                await context.reply("Please type any message in a Channel with the bot present to set the broadcast channel.");
                user_context_broadcast_origin_message = context;
                user_context_broadcast_set = true;
            }else{
                await context.reply("You cannot perform this command as you are not an admin.");
            }
        }else{
            await context.reply("Cannot set this chat as the main group chat. It isn't a group chat.");
        } 
    });

    telegram_bot.command("set_main_group_chat", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        if (!message){
            return;
        }

        let instigator_id = message.from.id;

        let command_match = message.text.match(/(?<Command>\/[\w@_]+) (?<Parameter>.+)/);

        if (chat.type == "group" || chat.type == "supergroup"){
            if (command_match){
                let code = command_match.groups!.Parameter!;

                if (code.trim() == one_time_code){
                    if (get_main_group_chat_id() == chat.id){
                        return context.reply("This group chat has already been marked as the main group chat.");
                    }
                    await set_main_group_chat(chat.id);
                    await context.reply("This group chat has been marked as the main group chat.");
                    generate_one_time_code();
                }else{
                    console.warn(`Security Warning: Someone by the name of ${message.from.first_name} or @${message.from.username} is trying to change the main group chat but entered the wrong code.`);
                    await context.reply("This is the wrong one-time code. Please try again.");
                }
            }else{
                await context.reply("When running the /set_main_group_chat command. You must specify the one-time code generated from the stdout of this bot." + 
                    " Without it, you are not permitted to move this bot main group chat to another one. Please fetch it!"
                );
            }
        }else{
            await context.reply("Cannot set this chat as the main group chat. It isn't a group chat.");
        }
    });

    telegram_bot.command("authorize_pin", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        if (!message){
            return;
        }

        let instigator_id = message.from.id;

        if (chat.type == "group" || chat.type == "supergroup"){
            let administrator_profile = await determine_administrator_role(instigator_id, get_main_group_chat_id());

            if (administrator_profile){
                let username_match = message.text.match(/\/[^ ]+ (.+)/);

                if (username_match){
                    let username = username_match[1];
                    
                    let index = system_data.authorized_usernames.findIndex(va=>username==va);

                    if (index == -1){
                        await context.reply(`Authorized ${username} to make pins!`);
                        system_data.authorized_usernames.push(username!);
                        await save_system_data();
                    }else{
                        await context.reply(`${username} is already authorized to make pins!`);
                    }
                }else{
                    await context.reply("What is the username? Please repeat the command by following this example: /authorize_pin username");
                }
            }else{
                await context.reply("You cannot perform this command as you are not an admin.");
            }
        }else{
            await context.reply("Cannot set this chat as the main group chat. It isn't a group chat.");
        }
    });

    telegram_bot.command("deauthorize_pin", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        if (!message){
            return;
        }

        let instigator_id = message.from.id;

        if (chat.type == "group" || chat.type == "supergroup"){
            let administrator_profile = await determine_administrator_role(instigator_id, get_main_group_chat_id());

            if (administrator_profile){
                let username_match = message.text.match(/\/[^ ]+ (.+)/);

                if (username_match){
                    let username = username_match[1];
                    
                    let index = system_data.authorized_usernames.findIndex(va=>username==va);

                    if (index == -1){
                        await context.reply(`${username} is already not authorized to make pins!`);
                    }else{
                        await context.reply(`Deauthorized ${username} from make pins!`);
                        system_data.authorized_usernames.splice(index, 1);
                        await save_system_data();
                    }
                }else{
                    await context.reply("What is the username? Please repeat the command by following this example: /deauthorize_pin username");
                }
            }else{
                await context.reply("You cannot perform this command as you are not an admin.");
            }
        }else{
            await context.reply("Cannot set this chat as the main group chat. It isn't a group chat.");
        }
    });

    telegram_bot.command("pin", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        if (!message){
            return;
        }

        if (system_data.main_group_chat_id == 0){
            return await context.reply("This bot is not fully configured to pin messages! Please identify the main group chat first!");
        }

        if (system_data.broadcast_channel_id == 0){
            return await context.reply("This bot is not fully configured to pin messages! Please identify the broadcast channel first!");
        }

        let instigator_id = message.from.id;

        let username_index = system_data.authorized_usernames.findIndex(va=>message.from.username==va);

        if (username_index == -1){
            return await context.reply("This user is not part of the list authorized to make pins. Please run /authorize_pin to authorize the user in the group chat!");
        }
        
        if (chat.type == "private"){
            await context.reply("<b>➡️ Forward me the furmeet message from the group chat so I can pin it!</b>", {parse_mode: "HTML"});
            
            start_pin_process(instigator_id);
        }else{
            await context.reply("Please run the pin command within my Private Channel!");
        }
    });

    telegram_bot.command("get_upcoming_meets", async (context)=>{
        let message = context.message;
        let chat = context.chat;

        let upcoming_meets: Meet[] = [];

        for (let i = 0;i<system_data.number_of_events;i++){
            let meet_raw_data = await database.readData(i + 1);

            let meet = JadeStruct.toObject(meet_raw_data.Buffer) as Meet;

            if (meet.planned_date.getTime() > Date.now()){
                upcoming_meets.push(meet);
            }

            if (upcoming_meets.length >= 5){
                break;
            }
        }

        let text = `Here is a list of upcoming furmeets!\n\n` + 
        ``;

        for (let meet of upcoming_meets){
            text += ` - ${meet.meet_name} on ${meet.planned_date.toLocaleString("en-US", {timeZone: "America/Edmonton"})} hosted by @${meet.planner}\n`;
        }

        context.reply(text);
    });

    telegram_bot.on("message:forward_origin", async (context)=>{

        let message = context.message;
        let instigator_id = message.from.id;

        if (context.chat.type == "private"){

            let user_pin_process = get_current_pin_process(instigator_id);

            if (user_pin_process.context == "Forwarding"){
                console.log(`Successfully processed a forwarded message from`);
                let meet_info_text = message.text || message.caption || "";
                let is_image = message.photo != null;

                let image: Buffer | undefined;

                if (is_image){
                    let files = message.photo!;
                    let file = files[files.length - 1];

                    let downloadable_file = await telegram_bot.api.getFile(file!.file_id);

                    image = await download_image(`https://api.telegram.org/file/bot${telegram_bot_api_key}/${downloadable_file.file_path}`);
                }

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
                    let identified_likely_date = meet_info_text.match(/(\d+)(?:(?:th)|(?:st)|(?:nd)|(?:rd)|)/);

                    if (identified_likely_date){
                        identified_date.setDate(Number(identified_likely_date[1]!));
                        was_identifiable = true
                    }

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

                    for (let month_match of month_matches){
                        if (meet_info_text.match(new RegExp(` ${month_match[0]} `, "i"))){

                            if (month_match[1] < 5 && new Date().getMonth() == 11){
                                identified_date.setFullYear(identified_date.getFullYear() + 1);
                            }

                            identified_date.setMonth(month_match[1]);
                            was_identifiable = true
                            break;
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
                    

                        identified_date = new Date(`${identified_date.toDateString()} ${hour_str}:${minute_str}:${second_str} ${segment} GMT-0700 (Mountain Standard Time)`);
                    }
                }

                user_pin_process.forwarded_meet_info = {
                    planned_date: identified_date,
                    planner: identified_planner,
                    pinner: identified_pinner,
                    message_id: message.message_id,
                    chat_id: context.chat.id,
                    meet_name: "",
                    meet_info: meet_info_text,
                    attached_meet_media: image
                };

                user_pin_process.context = "NameInput";

                await context.reply(`I've pulled the meet details!
The meet is on <b>${identified_date.toLocaleString("en-US", {timeZone: "America/Edmonton"})}</b>, and <b>@${identified_planner}</b> is the planner.

I can't create a meet name >:(
<b>Tell me the meet's name,</b> <u>then I'll ask if anything needs correcting.</u>
`, {parse_mode: "HTML"});
            }
        }
    });

    telegram_bot.on("message:text", async (context)=>{

        let message = context.message;
        let instigator_id = message.from.id;

        if (context.chat.type == "private"){

            let user_pin_process = get_current_pin_process(instigator_id);

            if (user_pin_process){
                switch(user_pin_process.context){
                    case "NameInput":{
                        let meet_name = message.text;

                        await context.reply(
                            `Nice! I will call this meet the <b>${meet_name}</b>!~`
                        , {parse_mode: "HTML"});

                        user_pin_process.forwarded_meet_info!.meet_name = meet_name;
                    }
                    case "EditingDate":{
                        if (user_pin_process.context == "EditingDate"){
                            let parsed_date = new Date(`${message.text} GMT-0700 (Mountain Standard Time)`);

                            if (!Number.isNaN(parsed_date.getTime())){
                                await context.reply(
                                    `I think the correct date is <b>${parsed_date.toLocaleString("en-US", {timeZone: "America/Edmonton"})}</b>!\n` +
                                    `I will use this for the meet!~`
                                , {parse_mode: "HTML"});

                                user_pin_process.forwarded_meet_info!.planned_date = parsed_date;
                            }else{
                                await context.reply(`I don't understand that date…

Try using a format I can read, like:
2/19/2026 - which means February 19th 2026.
`);
                            }
                        }
                    }
                    case "EditingName":{
                        if (user_pin_process.context == "EditingName"){
                            let correct_name = message.text;

                            await context.reply(
                                `I think the correct name is <b>${correct_name}</b>!\n` +
                                `I will use this for the meet!`
                            , {parse_mode: "HTML"});

                            user_pin_process.forwarded_meet_info!.meet_name = correct_name;
                        }
                    }
                    case "Editing":{

                        if (user_pin_process.context == "Editing"){
                            let choice_made = false;

                            let command_match = message.text.match(/(\w+) (.+)?/);
                            let command = message.text;
                            let parameter = "";

                            if (command_match){
                                command = command_match[1]!;
                                parameter = command_match[2]!;
                            }


                            switch(command.toLowerCase().trim()){
                                case "date":{

                                    let parsed_date = new Date(`${parameter} GMT-0700 (Mountain Standard Time)`);

                                    if (parameter.length > 6 && !Number.isNaN(parsed_date.getTime())){
                                        await context.reply(
                                            `I think the correct date is <b>${parsed_date.toLocaleString("en-US", {timeZone: "America/Edmonton"})}</b>!\n` +
                                            `I will use this for the meet!~`
                                        , {parse_mode: "HTML"});

                                        user_pin_process.forwarded_meet_info!.planned_date = parsed_date;
                                    }else{
                                        user_pin_process.context = "EditingDate";
                                        await context.reply("Alright! Tell me the correct date and I will do my best to understand it!");
                                        choice_made = true;
                                    }
                                    break;
                                }
                                case "name":{

                                    let meet_name = parameter;

                                    if (meet_name.length > 5){
                                        await context.reply(
                                            `Nice! I will call this meet the <b>${meet_name}</b>!~`
                                        , {parse_mode: "HTML"});

                                        user_pin_process.forwarded_meet_info!.meet_name = meet_name;
                                    }else{
                                        user_pin_process.context = "EditingName";
                                        await context.reply("Alright! Tell me the correct name and I will remember that meet as such!");
                                        choice_made = true;
                                    }


                                    break;
                                }
                                case "cancel":{
                                    user_pin_process.context = "Done";
                                    await context.reply("Alright! This meeting will not be posted!");
                                    choice_made = true;
                                    break;
                                }
                                case "done":{
                                    user_pin_process.context = "Done";
                                    await context.reply("Sounds good. I will be pinning it soon. uwu");

                                    await telegram_bot.api.sendMessage(
                                        system_data.main_group_chat_id, 
                                        `I have pinned a <b>meet</b> on behalf of @${message.from.username!}, wait a second as it's coming up!`
                                    , {parse_mode: "HTML"});

                                    await telegram_bot.api.forwardMessage(
                                        system_data.broadcast_channel_id,
                                        user_pin_process.forwarded_meet_info!.chat_id,
                                        user_pin_process.forwarded_meet_info!.message_id
                                    );

                                    let current_meet_index = system_data.number_of_events + 1;

                                    await database.writeData(
                                        JadeStruct.toJadeStruct(user_pin_process.forwarded_meet_info).convertToNodeJSBuffer(), 
                                        current_meet_index, 
                                        "Meet"
                                    );
                                    system_data.number_of_events += 1;

                                    await save_system_data();


                                    choice_made = true;
                                    break;
                                }
                                default:{
                                    await context.reply(
                                        `I do not understand what you meant...\n` + 
                                        `If you want to specify a correct date, try chatting me with this <b>Date</b> or <b>Date February 19th 2026</b>`
                                    , {parse_mode: "HTML"});
                                }
                            }
                            
                            if (choice_made){
                                break;
                            }
                        }

                        user_pin_process.context = "Editing";

                        let meet_name = user_pin_process.forwarded_meet_info!.meet_name;
                        let meet_date = user_pin_process.forwarded_meet_info!.planned_date.toLocaleString("en-US", {timeZone: "America/Edmonton"});
                        let warning = user_pin_process.forwarded_meet_info!.planned_date.getTime() < Date.now();

                        await context.reply(`For this step of the pinning process,
you can make corrections to the meet's details.

Reply <b>Date</b> to correct the meet date  
Reply <b>Name</b> to correct the meet name  
Reply <b>Cancel</b> to stop this operation :(  
Reply <b>Done</b> to confirm everything is correct :3

So far, I think the meet is called <b>${meet_name}</b>
and is on <b>${meet_date}</b>.\n` + 
(warning ? `<u>This meet appears to be in the past.  
If you submit it now, it won't be visible. :(</u>` : ""), {parse_mode: "HTML"});
                        break;
                    }
                }
            }
        }
    });

    telegram_bot.on("channel_post", async (context)=>{
        let message = context.message;

        if (user_context_broadcast_set){
            await set_broadcast_channel(context.chat.id);
            user_context_broadcast_set = false;
            user_context_broadcast_origin_message!.reply("The channel has been identified. Any pins will go to that channel!");
        }
    });


    // await telegram_bot.init();
    console.log("Logging into bots...");
    telegram_bot.start();

    console.log("Logged into Telegram!");
    await new Promise<void>((accept, reject)=>{
        discord_bot.once("clientReady", (readyClient)=>{
            accept();
        });
        discord_bot.login(discord_bot_api_key);
    });

    let commands = new Collection<string, {
        data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
        execute: (interaction: ChatInputCommandInteraction)=>(Promise<void>)
    }>();


    async function update_commands(){
        let commands_for_discord: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];

        
        for (let command of commands){
            commands_for_discord.push(command[1].data.toJSON());
        }

        await rest.put(Routes.applicationCommands(client_id), {body: commands_for_discord});
    }

    const thumbnail_attachment = new AttachmentBuilder("./resources/thumbnail.png");

    function create_discord_bot_embed(){
        return new EmbedBuilder()
            .setColor(0x00AAFF)
            .setTitle("Calgary Furmeet's Telegram/Discord")
            .setURL("https://t.me/CalgaryFurMeets")
            .setThumbnail("attachment://thumbnail.png")
    }

    let meet_selection_option = new SlashCommandStringOption();
    meet_selection_option.setName("meet_name");
    meet_selection_option.setDescription("The name of the meet you want to look up the information for");
    meet_selection_option.setRequired(true);
    
    commands.set("get_upcoming_meets", {
        data: new SlashCommandBuilder()
            .setName("get_upcoming_meets")
            .setDescription("Obtain a list of upcoming meets from Telegram. Run me to update the bot!"),
        async execute(interation: ChatInputCommandInteraction){
            let upcoming_meets: Meet[] = [];

            for (let i = 0;i<system_data.number_of_events;i++){
                let meet_raw_data = await database.readData(i + 1);

                let meet = JadeStruct.toObject(meet_raw_data.Buffer) as Meet;

                if (meet.planned_date.getTime() > Date.now()){
                    upcoming_meets.push(meet);
                }

                if (upcoming_meets.length >= 5){
                    break;
                }
            }

            let embed_builder = create_discord_bot_embed();

            embed_builder.setDescription("Here is a list of upcoming furmeets!");
            embed_builder.setTimestamp(new Date());

            meet_selection_option.setChoices();

            let index = 0;
            for (let meet of upcoming_meets){

                meet_selection_option.addChoices({name: meet.meet_name, value: `Meet: #${index}`});

                embed_builder.addFields({
                    name: `**${meet.meet_name}**`,
                    value: `<t:${Math.round(meet.planned_date.getTime() / 1000)}:f> (in <t:${Math.round(meet.planned_date.getTime() / 1000)}:R>) hosted by **@${meet.planner}** on Telegram!`,
                });

                index ++
            }


            interation.reply({
                embeds: [embed_builder],
                files: [thumbnail_attachment]
                // flags: MessageFlags.Ephemeral
            });

            await update_commands();
        }
    });



    commands.set("get_meet_info", {
        data: new SlashCommandBuilder()
            .setName("get_meet_info")
            .setDescription("Obtain the meet info (directly copy) from Telegram by specifying the name of the meet.")
            .addStringOption(meet_selection_option),
        async execute(interation: ChatInputCommandInteraction){
            let upcoming_meets: Meet[] = [];

            for (let i = 0;i<system_data.number_of_events;i++){
                let meet_raw_data = await database.readData(i + 1);


                let meet = JadeStruct.toObject(meet_raw_data.Buffer) as Meet;

                if (meet.planned_date.getTime() > Date.now()){
                    upcoming_meets.push(meet);
                }

                if (upcoming_meets.length >= 5){
                    break;
                }
            }

            let embed_builder = create_discord_bot_embed();

            let text = `I cannot find the meet you are looking for.\n`;

            let index = Number(interation.options.getString("meet_name")!.match(/Meet: #(\d)+/)![1]!);

            if (index < system_data.number_of_events){
                let raw_meet_data = await database.readData(index + 1);

                let meet = JadeStruct.toObject(raw_meet_data.Buffer) as Meet;

                let files: AttachmentBuilder[] = [];

                if (meet.attached_meet_media){
                    files.push(
                        new AttachmentBuilder(meet.attached_meet_media)
                            .setName("meet_media.jpg")
                    );
                }

                files.push(thumbnail_attachment);

                embed_builder.setDescription(`**${meet.meet_name}** hosted on **<t:${Math.round(meet.planned_date.getTime() / 1000)}:f>**` +
                    ` (in <t:${Math.round(meet.planned_date.getTime() / 1000)}:R>) hosted by **@${meet.planner}** on Telegram!\n\n` + 
                    `\`\`\`text\n${meet.meet_info}\`\`\``);

                embed_builder.setImage("attachment://meet_media.jpg");
                
                interation.reply({
                    embeds: [embed_builder],
                    files: files
                    // flags: MessageFlags.Ephemeral
                });
            }else{

                embed_builder.setDescription("I cannot find the meet you are looking for. :(");
                interation.reply({
                    embeds: [embed_builder],
                    files: [thumbnail_attachment]
                    // flags: MessageFlags.Ephemeral
                });
            }
        }
    });

    

    discord_bot.on("interactionCreate", async (interation)=>{
        if (!interation.isChatInputCommand()) return;

        let command = commands.get(interation.commandName);

        if (!command){
            return;
        }

        await command.execute(interation);
    });

    await update_commands();

    console.log("Logged into Discord!");
    


})();
