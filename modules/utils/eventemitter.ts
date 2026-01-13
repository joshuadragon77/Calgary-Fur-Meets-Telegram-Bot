export class EventEmitter<EventMapping>{

    eventListeners = new Map<keyof EventMapping, ((...args: EventMapping[keyof EventMapping][])=>(void))[]>();
    endedListeners = new Map<keyof EventMapping, EventMapping[keyof EventMapping][]>();

    constructor(events?: (keyof EventMapping)[]){
        if (events){
            for (let event of events){
                this.eventListeners.set(event, []);
            }
        }
    }

    protected fireEvent<EventName extends keyof EventMapping>(eventName: EventName, ...args: EventMapping[EventName][]){
        this.ensureEvent(eventName);
        for (let eventListener of this.eventListeners.get(eventName)!){
            eventListener(...args);
        }
    }

    protected endEvent<EventName extends keyof EventMapping>(eventName: EventName, ...args: EventMapping[EventName][]){
        if (this.endedListeners.has(eventName)){
            return;
        }
        this.ensureEvent(eventName);
        this.endedListeners.set(eventName, args);
        for (let eventListener of this.eventListeners.get(eventName)!){
            eventListener(...args);
        }
    }

    private ensureEvent(event: keyof EventMapping){
        if (this.eventListeners.has(event) == false){
            this.eventListeners.set(event, []);
        }
    }

    public on<EventName extends keyof EventMapping>(eventName: EventName, eventListener: (...args: EventMapping[EventName][])=>(void)){
        this.ensureEvent(eventName);
        if (this.endedListeners.has(eventName)){
            eventListener(...this.endedListeners.get(eventName)! as any);
            return;
        }
        this.eventListeners.get(eventName)?.push(eventListener as any);
    }
    
    public once<EventName extends keyof EventMapping>(eventName: EventName, eventListener: (...args: EventMapping[EventName][])=>(void)){
        this.ensureEvent(eventName);
        if (this.endedListeners.has(eventName)){
            eventListener(...this.endedListeners.get(eventName)! as any);
            return;
        }
        this.eventListeners.get(eventName)!.push((...args)=>{
            this.off(eventName, eventListener);
            eventListener(...args as any);
        });
        
    }

    public addEventListener<EventName extends keyof EventMapping>(eventName: EventName, eventListener: (...args: EventMapping[EventName][])=>(void)){
        this.on(eventName, eventListener);
    }

    public off<EventName extends keyof EventMapping>(eventName: EventName, eventListener: (...args: EventMapping[EventName][])=>(void)){
        this.ensureEvent(eventName);
        let listOfEventListener = this.eventListeners.get(eventName);
        
        if (listOfEventListener){
            let foundIndex = listOfEventListener.findIndex(va=>va==eventListener);

            if (foundIndex != -1){
                listOfEventListener.splice(foundIndex, 1);
            }
        }
    }

    public removeEventListener<EventName extends keyof EventMapping>(eventName: EventName, eventListener: (...args: EventMapping[EventName][])=>(void)){
        this.off(eventName, eventListener);
    }
}
