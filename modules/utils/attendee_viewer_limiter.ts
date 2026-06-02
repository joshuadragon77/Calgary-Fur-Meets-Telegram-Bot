// because fuck Telegram and Discord for ruining my current solution with character limits :P

import { truncate } from "fs";
import type { DiscordUser, Meet, MeetAttendee, TelegramUser } from "./meet_manager.js";

export class AttendeeViewerLimiter{


    public static generate_meet_view(meet: Meet, remaining_characters: number, view_type: "Telegram" | "Discord" = "Telegram"){
        
        let truncate = (str: string)=>{
            if (str.length >= 17){
                return `${str.substring(0, 17)}...`;
            }else{
                return str;
            }
        }

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

            switch(view_type){
                case "Telegram":{
                    switch(attendee.user_type){
                        case "Telegram":{
                            let telegram_user = attendee.user as TelegramUser;
                            list.push(`<a href="tg://user?id=${telegram_user.user_id}">@${telegram_user.username || truncate(telegram_user.full_name)}</a>`);
                            break;
                        }
                        case "Discord":{
                            let discord_user = attendee.user as DiscordUser;
                            list.push(`<a href="https://discord.com/users/${discord_user.snowflake_id}">🎮@${discord_user.username}</a>`);
                            break;
                        }
                    }
                    break;
                }
                case "Discord":{
                    switch(attendee.user_type){
                        case "Telegram":{
                            let telegram_user = attendee.user as TelegramUser;
                            list.push(`<:telegram_logo:1499302521670467644>[${telegram_user.username || truncate(telegram_user.full_name)}](https://t.me/${telegram_user.username})`);
                            break;
                        }
                        case "Discord":{
                            let discord_user = attendee.user as DiscordUser;
                            list.push(`<:discord_logo:1499303188124143626><@${discord_user.snowflake_id}>`);
                            break;
                        }
                    }
                    break;
                }
            }
        }

        let list_index = "accepted" as "accepted" | "need_car" | "maybe" | "maybe_not" | "not_interested" | "declined";

        //TODO: Horrible edge case if predetermination leads to unknown behaviour if character limit is already reached before the next list is approached.

        let character_right_limit = 10;

        if (text_attendance_list.accepted.length > 0 || view_type == "Discord")
            character_right_limit += 14 + 4;

        if (text_attendance_list.need_car.length > 0 || view_type == "Discord")
            character_right_limit += 16 + 4;

        if (text_attendance_list.maybe.length > 0 || view_type == "Discord")
            character_right_limit += 10 + 4;

        if (text_attendance_list.maybe_not.length > 0 || view_type == "Discord")
            character_right_limit += 14 + 4;

        if (text_attendance_list.not_interested.length > 0 || view_type == "Discord")
            character_right_limit += 19 + 4;

        if (text_attendance_list.declined.length > 0 || view_type == "Discord")
            character_right_limit += 16 + 4;

        remaining_characters -= character_right_limit;

        let attendance_count_list = {
            accepted: text_attendance_list.accepted.length,
            need_car: text_attendance_list.need_car.length,
            maybe: text_attendance_list.maybe.length,
            maybe_not: text_attendance_list.maybe_not.length,
            not_interested: text_attendance_list.not_interested.length,
            declined: text_attendance_list.declined.length,
        }

        let text_attendance_list_finalized = {
            accepted: [] as string[],
            need_car: [] as string[],
            maybe: [] as string[],
            maybe_not: [] as string[],
            not_interested: [] as string[],
            declined: [] as string[],
        }

        let cleared = true;


        while (true){
            let current_list;
            let finalized_list;

            let current_list_index = list_index;
            

            switch(current_list_index){
                case "accepted": {
                    cleared = true;
                    finalized_list = text_attendance_list_finalized.accepted;
                    current_list = text_attendance_list.accepted;
                    list_index = "need_car";
                    break;
                }
                case "need_car": {
                    finalized_list = text_attendance_list_finalized.need_car;
                    current_list = text_attendance_list.need_car;
                    list_index = "maybe";
                    break;
                }
                case "maybe": {
                    finalized_list = text_attendance_list_finalized.maybe;
                    current_list = text_attendance_list.maybe;
                    list_index = "maybe_not";
                    break;
                }
                case "maybe_not": {
                    finalized_list = text_attendance_list_finalized.maybe_not;
                    current_list = text_attendance_list.maybe_not;
                    list_index = "not_interested";
                    break;
                }
                case "not_interested": {
                    finalized_list = text_attendance_list_finalized.not_interested;
                    current_list = text_attendance_list.not_interested;
                    list_index = "declined";
                    break;
                }
                case "declined": {
                    finalized_list = text_attendance_list_finalized.declined;
                    current_list = text_attendance_list.declined;
                    list_index = "accepted";
                    break;
                }
            }

            let meet_attendee = current_list.shift();

            if (meet_attendee){
                cleared = false;
                finalized_list.push(meet_attendee);

                remaining_characters -= meet_attendee.length + 2;

                if (meet_attendee.length >= remaining_characters){
                    break;
                }
            }else{
                if (current_list_index == "declined" && cleared){
                    break;
                }
            }
        }

        if (text_attendance_list.accepted.length > 0){
            text_attendance_list_finalized.accepted.push(`+${text_attendance_list.accepted.length} others`);
        }
        if (text_attendance_list.need_car.length > 0){
            text_attendance_list_finalized.need_car.push(`+${text_attendance_list.need_car.length} others`);
        }
        if (text_attendance_list.maybe.length > 0){
            text_attendance_list_finalized.maybe.push(`+${text_attendance_list.maybe.length} others`);
        }
        if (text_attendance_list.maybe_not.length > 0){
            text_attendance_list_finalized.maybe_not.push(`+${text_attendance_list.maybe_not.length} others`);
        }
        if (text_attendance_list.not_interested.length > 0){
            text_attendance_list_finalized.not_interested.push(`+${text_attendance_list.not_interested.length} others`);
        }
        if (text_attendance_list.declined.length > 0){
            text_attendance_list_finalized.declined.push(`+${text_attendance_list.declined.length} others`);
        }

        let text_attendance_list_finalized_raw = view_type == "Discord" ? {
            accepted: "   ",
            need_car: "   ",
            maybe: "   ",
            maybe_not: "   ",
            not_interested: "   ",
            declined: "   ",
        } : {
            accepted: "",
            need_car: "",
            maybe: "",
            maybe_not: "",
            not_interested: "",
            declined: "",
        };

        switch(view_type){
            case "Telegram":{
                if (text_attendance_list_finalized.accepted.length > 0)
                    text_attendance_list_finalized_raw.accepted = `✅ Attendees (#${attendance_count_list.accepted}): ${text_attendance_list_finalized.accepted.join(", ")}`;
        
                if (text_attendance_list_finalized.need_car.length > 0)
                    text_attendance_list_finalized_raw.need_car = `🚘 Need a ride (#${attendance_count_list.need_car}): ${text_attendance_list_finalized.need_car.join(", ")}`;
        
                if (text_attendance_list_finalized.maybe.length > 0)
                    text_attendance_list_finalized_raw.maybe = `🤔 Maybe (#${attendance_count_list.maybe}): ${text_attendance_list_finalized.maybe.join(", ")}`;
        
                if (text_attendance_list_finalized.maybe_not.length > 0)
                    text_attendance_list_finalized_raw.maybe_not = `😔 Maybe not (#${attendance_count_list.maybe_not}): ${text_attendance_list_finalized.maybe_not.join(", ")}`;
        
                if (text_attendance_list_finalized.not_interested.length > 0)
                    text_attendance_list_finalized_raw.not_interested = `💔 Not interested (#${attendance_count_list.not_interested}): ${text_attendance_list_finalized.not_interested.join(", ")}`;
        
                if (text_attendance_list_finalized.declined.length > 0)
                    text_attendance_list_finalized_raw.declined = `❌ Cannot come (#${attendance_count_list.declined}): ${text_attendance_list_finalized.declined.join(", ")}`;
                break;
            }
            case "Discord":{
                text_attendance_list_finalized_raw.accepted = `__✅ Attendees (#${attendance_count_list.accepted}):__ ${text_attendance_list_finalized.accepted.join(", ")}`;
    
                text_attendance_list_finalized_raw.need_car = `__🚘 Need a ride (#${attendance_count_list.need_car}):__ ${text_attendance_list_finalized.need_car.join(", ")}`;
    
                text_attendance_list_finalized_raw.maybe = `__🤔 Maybe (#${attendance_count_list.maybe}):__ ${text_attendance_list_finalized.maybe.join(", ")}`;
    
                text_attendance_list_finalized_raw.maybe_not = `__😔 Maybe not (#${attendance_count_list.maybe_not}):__ ${text_attendance_list_finalized.maybe_not.join(", ")}`;
    
                text_attendance_list_finalized_raw.not_interested = `__💔 Not interested (#${attendance_count_list.not_interested}):__ ${text_attendance_list_finalized.not_interested.join(", ")}`;
    
                text_attendance_list_finalized_raw.declined = `__❌ Cannot come (#${attendance_count_list.declined}):__ ${text_attendance_list_finalized.declined.join(", ")}`;
                break;
            }
        }

        return text_attendance_list_finalized_raw;
    }
}