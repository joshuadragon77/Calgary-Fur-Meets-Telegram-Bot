import { LowLevelJadeDB } from "../jadestores.js";
import { JadeStruct } from "../jadestruct.js";
import { EventEmitter } from "./eventemitter.js";
import * as console from "../consolescript.js";
import { OneTimePasswordGenerator } from "./otp.js";

type SystemData = {
    telegram: {
        trusted_chat: {
            chat_id: number,
            announcements: {
                enabled: boolean,
                binded_announcement_chat_id: number | undefined
            },
            pin_preference: {
                enabled: boolean,
                unpin_after_expirey: boolean,
                expirey_period: "1 day" | "2 day" | "4 day" | "8 day" | "16 day"
            }
        }[],
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

export type Meet = {
    planner: {
        discord?: string,
        telegram?: string
    },
    platform_specifics: {
        username: string,
        platform: "Discord" | "Telegram",
        telegram?: {
            message_id: number,
            chat_id: number
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
    attached_meet_media: Buffer | undefined
}

export type ParameterMeet = {
    planner: {
        discord?: string,
        telegram?: string
    },
    platform_specifics: {
        username: string,
        platform: "Discord" | "Telegram",
        telegram?: {
            message_id: number,
            chat_id: number
        }
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
            platform_specifics: parameterized_meet.platform_specifics,
            meet_name: parameterized_meet.meet_name,
            meet_id: new_index,
            meet_location: parameterized_meet.meet_location,
            meet_date: parameterized_meet.meet_date,
            meet_description: parameterized_meet.meet_description,
            meet_disabled: false,
            attached_meet_media: parameterized_meet.attached_meet_media
        }

        this.fireEvent("new_meet", meet);
        
        await this.save_system_data();
        await this.set_meet(meet);
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
    }
}