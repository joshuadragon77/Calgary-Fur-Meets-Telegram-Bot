import { createServer } from "http";
import Express from "express";
import { JadeStruct } from "../jadestruct.js";
import { LowLevelJadeDB } from "../jadestores.js";


class ImageServer{
    
    private image_database_stores = {
        temporary_stores_size: 0,
        permanat_stores_size: 0
    };

    private database;
    private express_server;

    private temporary_stores = new Map<number, Buffer>();

    constructor(store_name = "image_cache.db"){
        this.database = new LowLevelJadeDB(store_name);

        this.express_server = Express();

        let https_server = createServer(this.express_server);
        https_server.listen(38498);

    }

    async open(){
        await this.database.open();


    }

    async add_image(image_data: Buffer){

    }

    async store_image(image_index: number){
        
    }
}