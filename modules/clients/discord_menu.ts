import { createHash } from "crypto";
import * as console from "../consolescript.js"
import type { JadeStruct } from "../jadestruct.js";
import { MeetManager, type DiscordChannelConfiguration, type DiscordUser, type Meet, type TelegramUser } from "../utils/meet_manager.js";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelSelectMenuBuilder, ChatInputCommandInteraction, CheckboxBuilder, Client, Collection, ComponentType, ContainerBuilder, EmbedBuilder, GatewayIntentBits, InteractionContextType, LabelBuilder, Message, MessageFlags, ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, REST, RoleSelectMenuBuilder, Routes, SlashCommandBuilder, SlashCommandStringOption, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, TextDisplayBuilder, TextDisplayComponent, TextInputBuilder, TextInputStyle, type Interaction, type RESTPostAPIChatInputApplicationCommandsJSONBody, type SlashCommandOptionsOnlyBuilder } from "discord.js";
import { format_date } from "../utils/units.js";
import { truncate } from "fs";

export class DiscordHandler{

    private discord_bot;
    private meet_manager;
    private discord_bot_token: string;
    private discord_client_id: string;

    public constructor(discord_bot_token: string, discord_client_id: string, meet_manager: MeetManager){
        this.discord_bot = new Client({
            intents: [GatewayIntentBits.Guilds]
        });
        this.meet_manager = meet_manager;

        this.discord_bot_token = discord_bot_token;
        this.discord_client_id = discord_client_id;

    }

    public async attempt_sign_in(){
        console.log("Logging into Discord Bot...");
        await this.initialize_client();
    
        console.log("Logged into Discord Bot!");
    }
    
    async fetch_guild_configuration(interaction: Interaction){

        if (interaction.guild == undefined){
            return undefined
        }


        let current_system_data = this.meet_manager.read_system_data();
        let guild_id = interaction.guildId;
        

        let index = current_system_data.discord.trusted_server.findIndex(va=>guild_id == va.guild_id);

        if (index == -1){
            return undefined
        }else{
            return current_system_data.discord.trusted_server[index];
        }
    }


    async update_all_meet_posts(meet: Meet){

        let current_system_data = this.meet_manager.read_system_data();
                
        for (let post of meet.platform_specifics.tracked_posts.discord){

            try{
                let trusted_discord_server = current_system_data.discord.trusted_server.find(va=>va.guild_id == post.guild_id);

                if (trusted_discord_server){
                    let channel = await this.discord_bot.channels.fetch(post.channel_id) as TextChannel;
                    let message = await channel.messages.fetch(post.message_id);

                    let container_display = this.create_component_from_meet(meet, trusted_discord_server);

                    await message.edit({
                        content: "",
                        // embeds: [embed_builder],
                        components: [container_display],
                        flags: MessageFlags.IsComponentsV2
                    })
                }
            }
            catch(er){
                console.error(er);
            };
        }
    }

    async set_attendee_status (interaction: ButtonInteraction){

        let customId = interaction.customId;

        let button_class = customId.match(/^([^\d]+)_\d+/)![1];
        let meet_id = Number(customId.match(/^[^\d]+_(\d+)/)![1]);

        let attendance_status = button_class as "accepted" | "ride" | "maybe" | "maybenot" | "notinterested" | "declined";

        let meets = await this.meet_manager.get_meets();

        let meet = meets.find(va=>va.meet_id == meet_id)!;

        let discord_attendee = meet.attendance.find(va=>va.user_type == "Discord" && (va.user as DiscordUser).snowflake_id == interaction.user.id);

        let success: "Good" | "Bad" | "Error" = "Error";

        if (!discord_attendee){
            
            meet.attendance.push({
                user: { 
                    snowflake_id: interaction.user.id,
                    username: interaction.user.username,
                },
                user_type: "Discord",
                attendance_status: attendance_status
            });
            
            await this.meet_manager.set_meet(meet);
            success = "Good";
        }else{
            if (discord_attendee.attendance_status != attendance_status){
                discord_attendee.attendance_status = attendance_status;
                await this.meet_manager.set_meet(meet);
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

        let response = "";

        switch(success){
            case "Good":{
                response = (`🥳 Yip yip!\n\nYou have ${contextual_text} to this meet!`);
                break;
            }
            case "Bad":{
                response = (`😓 Awwww!\n\nIt appears you already have ${contextual_text} to this meet!`);
                break;
            }
            case "Bad":{
                response = (`🤖 Eof!\n\nAn error has occured trying to reply to this meet...`);
                break;
            }
        }
        interaction.reply({
            content: response,
            flags: MessageFlags.Ephemeral
        });
    }

    create_notification_from_meet = (meet: Meet, guild_configuration: DiscordChannelConfiguration)=>{

        let random_char = createHash("sha256").update(meet.meet_name).digest("binary").charCodeAt(0);

        let random_byte = random_char % 11; 

        let random_icon = [
            "🐶", "🦊", "🐱", "🦊", "🐺", "🐯", "🫎", "🐻", "🦇", "🐼", "🦅"
        ][random_byte];

        return `${(()=>{
            switch (guild_configuration.announcement_channels.ping_mode){
                case "everyone":{
                    return "@everyone";
                    break;
                }
                case "role":{
                    if (guild_configuration.announcement_channels.ping_role_id)
                        return `<@&${guild_configuration.announcement_channels.ping_role_id}>`;
                    break;
                }
                case "disabled":{
                    return "";
                    break;
                }
            }
        })()} 📣 New Furmeet Announced\n${random_icon}${meet.meet_name}\n📅${format_date(meet.meet_date)}`;
    }

    create_component_from_meet = (meet: Meet, guild_configuration: DiscordChannelConfiguration)=>{
        let random_char = createHash("sha256").update(meet.meet_name).digest("binary").charCodeAt(0);

        let random_byte = random_char % 11; 

        let random_icon = [
            "🐶", "🦊", "🐱", "🦊", "🐺", "🐯", "🫎", "🐻", "🦇", "🐼", "🦅"
        ][random_byte];

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

        let truncate = (str: string)=>{
            if (str.length >= 17){
                return `${str.substring(0, 17)}...`;
            }else{
                return str;
            }
        }
        
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
                list.push(`[@${telegram_user.username || truncate(telegram_user.full_name)} (➤)](https://t.me/${telegram_user.username})`);
            }else{
                let discord_user = attendee.user as DiscordUser;
                list.push(`<@${discord_user.snowflake_id}>`);
            }
        }

        let container_display = new ContainerBuilder({
            accent_color: 0x00AAFF,
            components: [
                {
                    content: `**[New Furmeet Announcement!](https://t.me/calgaryfurmeet)** ${(()=>{
                        switch (guild_configuration.announcement_channels.ping_mode){
                            case "everyone":{
                                return "@everyone";
                                break;
                            }
                            case "role":{
                                if (guild_configuration.announcement_channels.ping_role_id)
                                    return `<@&${guild_configuration.announcement_channels.ping_role_id}>`;
                                break;
                            }
                            case "disabled":{
                                return "";
                                break;
                            }
                        }
                    })()}`,
                    type: ComponentType.TextDisplay
                },
                {
                    divider: true,
                    type: ComponentType.Separator
                },
                {
                    content: `**${random_icon} ${meet.meet_name}**
On ${format_date(meet.meet_date)}
At [${meet.meet_location.name}](${(()=>{
            let { meet_location } = meet;

            if (meet_location.location.latitude && meet_location.location.longitude){
                return `https://www.google.com/maps/search/?api=1&query=${meet_location.location.latitude}%2C${meet_location.location.longitude}`;
            }else{
                return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meet_location.name)}`;
            }
        })()})
Hosted by [@${meet.planner.telegram}](https://t.me/${meet.planner.telegram})

*${meet.meet_description}*`,
                    type: ComponentType.TextDisplay
                },
                {
                    items: [
                        {media: {
                            url: "attachment://meet_media.jpg"
                        }}
                    ],
                    type: ComponentType.MediaGallery
                },
                {
                    divider: true,
                    type: ComponentType.Separator
                },
                {
                    components: [
                        {
                            content: `__✅ Coming (#${text_attendance_list.accepted.length}):__ ${text_attendance_list.accepted.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `accepted_${meet.meet_id}`,
                        label: "✅ Coming",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    components: [
                        {
                            content: `__🚘 Ride needed (#${text_attendance_list.need_car.length}):__ ${text_attendance_list.need_car.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `ride_${meet.meet_id}`,
                        label: "🚘 Ride needed",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    components: [
                        {
                            content: `__🤔 Maybe: (#${text_attendance_list.maybe.length}):__ ${text_attendance_list.maybe.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `maybe_${meet.meet_id}`,
                        label: "🤔 Maybe",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    components: [
                        {
                            content: `__😔 Maybe no: (#${text_attendance_list.maybe_not.length}):__ ${text_attendance_list.maybe_not.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `maybenot_${meet.meet_id}`,
                        label: "😔 Maybe no",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    components: [
                        {
                            content: `__❌ Not coming: (#${text_attendance_list.declined.length}):__ ${text_attendance_list.declined.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `declined_${meet.meet_id}`,
                        label: "❌ Not coming",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    components: [
                        {
                            content: `__💔 Not interested: (#${text_attendance_list.not_interested.length}):__ ${text_attendance_list.not_interested.join(", ")}`,
                            type: ComponentType.TextDisplay
                        },
                    ],
                    accessory: {
                        custom_id: `notinterested_${meet.meet_id}`,
                        label: "💔 Not interested",
                        style: ButtonStyle.Primary,
                        type: ComponentType.Button
                    },
                    type: ComponentType.Section
                },
                {
                    divider: true,
                    type: ComponentType.Separator
                },
                {
                    content:  `-# Last updated: ${format_date(new Date())}`,
                    type: ComponentType.TextDisplay
                },
            ]
        });

        if (!meet.attached_meet_media){
            container_display.spliceComponents(3, 1);
        }

        return container_display;
    }
    
    private async initialize_client(){

        this.meet_manager.on("delete_meet", async (meet: Meet)=>{
            for (let tracked_post of meet.platform_specifics.tracked_posts.discord){
                let channel = await this.discord_bot.channels.fetch(tracked_post.channel_id) as TextChannel;
                let message = await channel.messages.fetch(tracked_post.message_id);

                await message.delete();
            }
        });

        this.meet_manager.on("update_meet", async (meet: Meet)=>{
            await this.update_all_meet_posts(meet);
        });

        this.meet_manager.on("new_meet", async (meet)=>{

            let current_system_data = this.meet_manager.read_system_data();

            let trusted_discord_servers = current_system_data.discord.trusted_server;


            for (let trusted_discord_server of trusted_discord_servers){

                if (trusted_discord_server.enable_announcements && trusted_discord_server.announcement_channels.channel_id){
                    let channel_id = trusted_discord_server.announcement_channels.channel_id;

                    let channel = await this.discord_bot.channels.fetch(channel_id) as TextChannel | undefined;

                    if (channel){
                        let notification_text = this.create_notification_from_meet(meet, trusted_discord_server);
                        let container_display = this.create_component_from_meet(meet, trusted_discord_server);

                        let message = await channel.send({
                            content: notification_text
                        });

                        let attachment = meet.attached_meet_media ? [new AttachmentBuilder(meet.attached_meet_media).setName("meet_media.jpg")] : [];

                        await message.edit({
                            content: "",
                            files: attachment,
                            // embeds: [embed_builder],
                            components: [container_display],
                            flags: MessageFlags.IsComponentsV2
                        })

                        meet.platform_specifics.tracked_posts.discord.push({
                            message_id: message.id,
                            channel_id: message.channelId,
                            guild_id: trusted_discord_server.guild_id
                        });

                        await this.meet_manager.set_meet(meet);
                    }
                }

            }

        });

        let rest = new REST().setToken(this.discord_bot_token);
        
        await this.discord_bot.login(this.discord_bot_token);
            
        let commands = new Collection<string, {
            data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
            execute: (interaction: ChatInputCommandInteraction)=>(Promise<void>)
        }>();
        
        let modals = new Collection<string, {
            data: ModalBuilder,
            execute: (interaction: ModalSubmitInteraction)=>(Promise<void>)
        }>();

        let update_commands = async ()=>{
            let commands_for_discord: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];

            
            for (let command of commands){
                commands_for_discord.push(command[1].data.toJSON());
            }

            await rest.put(Routes.applicationCommands(this.discord_client_id), {body: commands_for_discord});
        }



        modals.set("discord_server_trust", {
            data: new ModalBuilder({
                title: "⚠️ Discord Server Trust",
                custom_id: "discord_server_trust",
                components: [
                    {
                        type: ComponentType.Label,
                        label: "Enter One-Time Passcode",
                        description: "This is the one-time passcode offered by the stdout of this bot to trust this Discord Server.",
                        component: {
                            type: ComponentType.TextInput,
                            custom_id: "otp_field",
                            placeholder: "0".repeat(30),
                            style: TextInputStyle.Short
                        }
                    }
                ]
            }),
            execute: async (interaction)=>{

                let guild_configuration = await this.fetch_guild_configuration(interaction);

                let guild_id = interaction.guildId!;

                let otp_manager = this.meet_manager.get_otp_generator();

                let otp_code = interaction.fields.getTextInputValue("otp_field");

                if (otp_manager.verify_one_time_password(otp_code)){
                    interaction.reply("✅ Verified that this Discord is trusted! Unlocked all features!");

                    let current_system_data = this.meet_manager.read_system_data();


                    if (!guild_configuration){
                        current_system_data.discord.trusted_server.push({
                            guild_id: guild_id,
                            enable_announcements: false,
                            announcement_channels: {
                                channel_id: "",
                                ping_mode: "disabled",
                                ping_role_id: "",
                            }
                        });

                        await this.meet_manager.save_system_data();
                    }

                    return;
                }
                    
                interaction.reply("⛔ Unable to verify this Diwscord Server!");
            }
        });

        modals.set("discord_server_configuration", {
            data: new ModalBuilder({
                title: "⚙️ Meet Announcement Configuration",
                custom_id: "discord_server_configuration",
                components: [
                    {
                        type: ComponentType.Label,
                        label: "Enable Announcement",
                        description: "Enable announcements on a meet creation",
                        component: {
                            type: ComponentType.Checkbox,
                            custom_id: "enable_announcement",
                        }
                    },
                    {
                        type: ComponentType.Label,
                        label: "Channel Announcement Location",
                        description: "Where the meets are announced into",
                        component: {
                            type: ComponentType.ChannelSelect,
                            custom_id: "channel_announcement_location"
                        }
                    },
                    {
                        type: ComponentType.Label,
                        label: "Announcement Ping",
                        description: "Configure how the bot should ping users.",
                        component: {
                            type: ComponentType.StringSelect,
                            options: [
                                {
                                    value: "everyone",
                                    label: "@everyone",
                                },
                                {
                                    value: "role",
                                    label: "@role",
                                },
                                {
                                    value: "disabled",
                                    label: "Ping Disabled",
                                },
                            ],
                            custom_id: "channel_announcement_ping"
                        }
                    },
                    {
                        type: ComponentType.Label,
                        label: "Announcement Ping Role",
                        description: "Configure which role the bot should ping. Applicable if @role is selected above.",
                        component: {
                            type: ComponentType.RoleSelect,
                            custom_id: "channel_announcement_ping_role"
                        }
                    },
                ]
            }),
            execute: async (interaction)=>{
                let guild_configuration = await this.fetch_guild_configuration(interaction);

                if (guild_configuration){
                    let enable_announcement_field = interaction.fields.getCheckbox("enable_announcement");
                    let channel_announcement_location_field = interaction.fields.getSelectedChannels("channel_announcement_location");
                    let channel_announcement_ping_field = interaction.fields.getStringSelectValues("channel_announcement_ping");
                    let channel_announcement_ping_role_field = interaction.fields.getSelectedRoles("channel_announcement_ping_role");

                    guild_configuration.enable_announcements = enable_announcement_field;
                    guild_configuration.announcement_channels.channel_id = channel_announcement_location_field!.at(0)!.id;
                    guild_configuration.announcement_channels.ping_mode = channel_announcement_ping_field.at(0)! as "everyone" | "role" | "disabled";
                    guild_configuration.announcement_channels.ping_role_id = channel_announcement_ping_role_field!.at(0)!.id;

                    await this.meet_manager.save_system_data();

                    interaction.reply("✅ Saved Bot Configuration of this guild!");
                }
            }
        });

        commands.set("authorize_guild", {
            data: new SlashCommandBuilder()
                .setName("authorize_guild")
                .setDescription("Authorize the Discord Server to unlock all bot's features")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .setContexts(InteractionContextType.Guild),
            execute: async (interaction: ChatInputCommandInteraction)=>{
                let guild_configuration = await this.fetch_guild_configuration(interaction);

                if (guild_configuration){
                    interaction.reply("This Discord Server is already trusted!");

                    return;
                }
                interaction.showModal(modals.get("discord_server_trust")!.data);
            }
        });

        commands.set("deauthorize_guild", {
            data: new SlashCommandBuilder()
                .setName("deauthorize_guild")
                .setDescription("Deauthorized the Discord Server")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .setContexts(InteractionContextType.Guild),
            execute: async (interaction: ChatInputCommandInteraction)=>{
                let current_system_data = this.meet_manager.read_system_data();
                let index = current_system_data.discord.trusted_server.findIndex(va=>interaction.guildId! == va.guild_id);

                if (index == -1){
                    interaction.reply("This Discord Server is already untrusted!");
                    return;
                }

                current_system_data.discord.trusted_server.splice(index, 1);

                await this.meet_manager.save_system_data();
            
                interaction.reply("✅ This Discord Server has been untrusted!");
            }
        });
        
        commands.set("configure_chat", {
            data: new SlashCommandBuilder()
                .setName("configure_chat")
                .setDescription("Configure the meet announcement configuration in this Discord Server.")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .setContexts(InteractionContextType.Guild),
            execute: async (interaction: ChatInputCommandInteraction)=>{

                let guild_configuration = await this.fetch_guild_configuration(interaction);

                if (guild_configuration){
                    
                    let discord_server_configuration_modal = modals.get("discord_server_configuration")!.data;
                    ((discord_server_configuration_modal.components[0] as LabelBuilder).data.component as CheckboxBuilder).setDefault(guild_configuration.enable_announcements);
                    if (guild_configuration.announcement_channels.channel_id)
                        ((discord_server_configuration_modal.components[1] as LabelBuilder).data.component as ChannelSelectMenuBuilder).setDefaultChannels(guild_configuration.announcement_channels.channel_id);

                    let options = ((discord_server_configuration_modal.components[2] as LabelBuilder).data.component as StringSelectMenuBuilder).options;

                    for (let option of options){
                        option.setDefault(option.data.value == guild_configuration.announcement_channels.ping_mode);
                    }

                    if (guild_configuration.announcement_channels.ping_role_id)
                        ((discord_server_configuration_modal.components[3] as LabelBuilder).data.component as RoleSelectMenuBuilder).setDefaultRoles(guild_configuration.announcement_channels.ping_role_id);

                    interaction.showModal(discord_server_configuration_modal);
                }else{
                    interaction.reply("This Discord Server is untrusted! Cannot run this command.");
                }
            }
        });

        this.discord_bot.on("interactionCreate", async (interation)=>{
            if (interation.isChatInputCommand()){
                let command = commands.get(interation.commandName);
    
                if (!command){
                    return;
                }
    
                await command.execute(interation);
            }

            if (interation.isModalSubmit()){
                let modal = modals.get(interation.customId);
    
                if (!modal){
                    return;
                }
    
                await modal.execute(interation);
            }
            
            if (interation.isButton()){
                await this.set_attendee_status(interation);
            }
        });

        await update_commands();


    }
}