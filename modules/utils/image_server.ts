import * as console from "../consolescript.js"
import { createServer } from "http";
import Express from "express";
import { JadeStruct } from "../jadestruct.js";
import { LowLevelJadeDB } from "../jadestores.js";
import { randomUUID } from "crypto";
import { read, readFileSync } from "fs";


export class ImageServer{
    
    private image_database_metadata = {
        permanent_stores_mapping: new Map<string, number>(),
    };

    private temporary_stores = new Map<string, Buffer>();

    private database;
    private express_server;

    constructor(store_name = "image_cache.db"){
        this.database = new LowLevelJadeDB(store_name);

        this.express_server = Express();

        let https_server = createServer(this.express_server);
        https_server.listen(38499);


        this.express_server.get("/fetch_image/*resource_name", async (request, response)=>{
            let params = request.params.resource_name;

            response.setHeader("Content-Type", "image/png");

            let image = await this.get_image(params[0]!);

            response.send(image);
        });
    }

    async open(){
        await this.database.open();

        if (this.database.getArrayLength() == 0){
            console.warn("Image Database server hasn't been setup yet.");
            await this.database.writeData(JadeStruct.toJadeStruct(this.image_database_metadata).convertToNodeJSBuffer(), 0, "Metadata");
        }else{
            this.image_database_metadata = JadeStruct.toObject((await this.database.readData(0)).Buffer);
        }

        console.log(this.image_database_metadata);

        let shit = await this.add_image(readFileSync("./example.jpg"));
        await this.store_image(shit);
    }

    async add_image(image_data: Buffer){
        let file_identifier = randomUUID();
        
        this.temporary_stores.set(file_identifier, image_data);

        return file_identifier;
    }

    async remove_image(file_identifer: string){
        this.temporary_stores.delete(file_identifer);
    }

    async store_image(file_identifer: string){
        
        let temporary_store = this.temporary_stores.get(file_identifer);

        if (temporary_store){
            let new_store_index = this.image_database_metadata.permanent_stores_mapping.size + 1;

            await this.database.writeData(temporary_store, new_store_index, "Image");

            this.image_database_metadata.permanent_stores_mapping.set(file_identifer, new_store_index);

            await this.database.writeData(JadeStruct.toJadeStruct(this.image_database_metadata).convertToNodeJSBuffer(), 0, "Metadata");
        }
    }

    async get_image(file_identifer: string){
        let permanent_store_index = this.image_database_metadata.permanent_stores_mapping.get(file_identifer);
        
        if (permanent_store_index){
            let permanent_store_raw_data = await this.database.readData(permanent_store_index);

            return permanent_store_raw_data.Buffer;
        }

        let temporary_store = this.temporary_stores.get(file_identifer);

        return temporary_store;
    }
}