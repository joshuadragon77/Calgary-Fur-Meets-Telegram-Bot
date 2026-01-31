import { LowLevelJadeDB } from "../jadestores.js";
import { JadeStruct } from "../jadestruct.js";
import { EventEmitter } from "./eventemitter.js";
import * as console from "../consolescript.js";
import { OneTimePasswordGenerator } from "./otp.js";
import { TelegramHandler } from "../clients/telegram_menu.js";

export type ChatConfiguration = {
    chat_id: number,
    announcements: {
        enabled: "Chat" | "Channel" | "Disabled",
        binded_announcement_chat_id: number | undefined
    },
    pin_preference: {
        enabled: boolean,
        unpin_after_expirey: boolean,
        expirey_period: "1 day" | "2 day" | "4 day" | "8 day" | "16 day"
    }
};

export type SystemData = {
    telegram: {
        trusted_chat: ChatConfiguration[],
        banned_user_ids: number[]
    }
    discord: {
        trusted_server: {
            server_id: number,
            enable_announcements: boolean 
            announcement_channels: {
                channel_id: string,
                pin_everyone: boolean
            }
        }[]
    },
    saved_meets: number
}

export type DiscordUser = {
    username: string,
    snowflake_id: number
}

export type TelegramUser = {
    username: string | undefined,
    user_id: number,
    full_name: string
}

export type MeetAttendee = {
    user: TelegramUser | DiscordUser;
    user_type: "Telegram" | "Discord";
    attendance_status: "accepted" | "ride" | "maybe" | "declined";
}

export type Meet = {
    version: "v0.1" | undefined
    planner: {
        discord: string | undefined,
        telegram: string | undefined
    },
    platform_specifics: {
        username: TelegramUser | DiscordUser,
        platform: "Discord" | "Telegram",
        telegram: {
            message_id: number;
            chat_id: number;
        } | undefined,
        tracked_posts: {
            telegram: {
                message_id: number,
                chat_id: number,
            }[],
            discord: any[]
        }
    }
    meet_name: string,
    meet_id: number,
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
    meet_disabled: boolean,
    attached_meet_media: Buffer | undefined,
    attendance: MeetAttendee[]

    // LEGACY, DO NOT USE
    attendees?: {
        telegram: TelegramUser[],
        discord: DiscordUser[]
    },
    nonattendees?: {
        telegram: TelegramUser[],
        discord: DiscordUser[]
    }
}

export type ParameterMeet = {
    planner: {
        discord: string | undefined,
        telegram: string | undefined
    },
    platform_specifics: {
        username: TelegramUser | DiscordUser,
        platform: "Discord" | "Telegram",
        telegram?: {
            message_id: number;
            chat_id: number;
        } | undefined
    }
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
    meet_disabled: boolean,
    attached_meet_media: Buffer | undefined
}

export class MeetManager extends EventEmitter<{
    "new_meet": Meet
}>{

    private otp_generator = new OneTimePasswordGenerator();
    private database = new LowLevelJadeDB("./database.db", 4096);
    private current_system_data: SystemData = {
        telegram: {
            trusted_chat: [],
            banned_user_ids: []
        },
        discord: {
            trusted_server: []
        },
        saved_meets: 0
    }

    constructor(){
        super();
    }

    read_system_data(){
        return this.current_system_data;
    }

    async save_system_data(){
        await this.database.writeData(JadeStruct.toJadeStruct(this.current_system_data).convertToNodeJSBuffer(), 0, "SystemData", 0);
    }

    get_otp_generator(){
        return this.otp_generator;
    }

    async post_meet(parameterized_meet: ParameterMeet){

        let new_index = this.current_system_data.saved_meets += 1;

        let meet: Meet = {
            planner: parameterized_meet.planner,
            platform_specifics: {
                platform: parameterized_meet.platform_specifics.platform,
                telegram: parameterized_meet.platform_specifics.telegram,
                username: parameterized_meet.platform_specifics.username,
                tracked_posts: {
                    telegram: [],
                    discord: []
                }
            },
            meet_name: parameterized_meet.meet_name,
            meet_id: new_index,
            meet_location: parameterized_meet.meet_location,
            meet_date: parameterized_meet.meet_date,
            meet_description: parameterized_meet.meet_description,
            meet_disabled: false,
            attached_meet_media: parameterized_meet.attached_meet_media,
            attendance: [],
            version: "v0.1"
        }

        this.fireEvent("new_meet", meet);
        
        await this.set_meet(meet);
        await this.save_system_data();
    }

    async get_meets(){
        let meets: Meet[] = []

        for (let i = 0;i<this.current_system_data.saved_meets;i++){
            let meet = await this.get_meet(i + 1);

            meets.push(meet);
        }

        return meets;
    }

    async get_upcoming_meets(){
        let meets: Meet[] = []

        for (let i = 0;i<this.current_system_data.saved_meets;i++){
            let meet = await this.get_meet(i + 1);

            if (meet.meet_disabled == false && meet.meet_date.getTime() >= Date.now()){
                meets.push(meet);
            }
        }

        return meets;
    }

    async get_meet(meet_index: number){
        let raw_meet = await this.database.readData(meet_index);
        let meet = JadeStruct.toObject(raw_meet.Buffer) as Meet;

        if (meet.version == undefined){
            console.warn(`Upgrading ${meet.meet_name} to v0.1 databasing...`);
            let new_attendance_list: MeetAttendee[] = [];

            for (let attendee of meet.attendees!.telegram){
                new_attendance_list.push({
                    user: attendee,
                    user_type: "Telegram",
                    attendance_status: "accepted"
                })
            }

            for (let attendee of meet.attendees!.discord){
                new_attendance_list.push({
                    user: attendee,
                    user_type: "Discord",
                    attendance_status: "accepted"
                })
            }

            for (let nonattendees of meet.nonattendees!.telegram){
                new_attendance_list.push({
                    user: nonattendees,
                    user_type: "Telegram",
                    attendance_status: "declined"
                })
            }

            for (let nonattendees of meet.nonattendees!.discord){
                new_attendance_list.push({
                    user: nonattendees,
                    user_type: "Discord",
                    attendance_status: "declined"
                })
            }

            meet.version = "v0.1";
            meet.attendance = new_attendance_list;

            await this.set_meet(meet);
            console.log(`Upgraded ${meet.meet_name} to v0.1 databasing!`);
        }

        return meet;
    }

    async set_meet(meet: Meet){
        let raw_meet = JadeStruct.toJadeStruct(meet).convertToNodeJSBuffer();
        
        await this.database.writeData(raw_meet, meet.meet_id, `Meet #${meet.meet_id}`);
    }

    async delete_meet(meet_index: number){
        let meet = await this.get_meet(meet_index);

        meet.meet_disabled = true;

        await this.set_meet(meet);
    }
    
    async start(){
        await this.database.open();

        if (!await this.database.exists(0)){
            console.warn("Generated new system data session due to no pre-existing one! ^-^");
            await this.database.writeData(JadeStruct.toJadeStruct(this.current_system_data).convertToNodeJSBuffer(), 0, "SystemData", 0);
        }else{
            console.log("Managed to retrieve previous system data session! ^-^");
            this.current_system_data = JadeStruct.toObject((await this.database.readData(0)).Buffer);
        }

        // setTimeout(() => {
            
        //     let meet: ParameterMeet = {
        //         planner: {
        //             telegram: "joshuadragon77",
        //             discord: undefined
        //         },
        //         platform_specifics: {
        //             username: {
        //                 user_id: 1,
        //                 username: "joshuadragon77"
        //             },
        //             platform: "Telegram",
        //             telegram: undefined,
        //         },
        //         meet_name: "Nose Hill Park Furwalk",
        //         meet_location: {
        //             name: "Nose Hill Park Parking Lot",
        //             address: "6465 14 St NW, Calgary, AB T2K 5R2",
        //             location: {
        //                 latitude: 51.10872291117884,
        //                 longitude: -114.08430683092935
        //             },
        //             valid: false
        //         },
        //         meet_date: new Date(),
        //         meet_description: "walk time",
        //         meet_disabled: false,
        //         attached_meet_media: undefined,
        //     }

        //     this.post_meet(meet);
        // }, 2000);
    }
}