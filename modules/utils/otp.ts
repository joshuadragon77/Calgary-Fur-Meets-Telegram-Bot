import * as console from "../consolescript.js";
import { randomBytes } from "crypto";

export class OneTimePasswordGenerator{

    private stored_one_time_password = "";

    constructor(){
        this.generate_one_time_password();
    }


    generate_one_time_password(){
        let bytes = randomBytes(30);

        this.stored_one_time_password = "";
        
        for (let byte of bytes){
            this.stored_one_time_password += `${byte % 10}`;
        }

        console.log(`The one time generated password is ${this.stored_one_time_password} . You can use this to unlock bot's full features on untrusted channels.`);
    }

    verify_one_time_password(password: string){
        if (this.stored_one_time_password == password){
            console.warn("Someone used the correct one time password! A channel has become trusted!");
            this.generate_one_time_password();
            return true;
        }else{
            console.warn("Someone entered the wrong one time password! Someone is trying to unlock this bot's full features on an untrusted channel!");
            return false;
        }
    }
}