// Type declarations for irc-framework
declare module 'irc-framework' {
  export interface IrcUser {
    nick: string;
    username?: string;
    hostname?: string;
    gecos?: string;
    modes?: string[];
  }

  export interface MessageEvent {
    nick: string;
    ident?: string;
    hostname?: string;
    target: string;
    message: string;
    time?: number;
    tags?: Record<string, string>;
  }

  export interface ClientOptions {
    host: string;
    port: number;
    nick: string;
    username?: string;
    gecos?: string;
    tls?: boolean;
    password?: string;
    account?: {
      account: string;
      password: string;
    };
  }

  export class Client {
    user: IrcUser;
    
    constructor();
    
    connect(options: ClientOptions): void;
    join(channel: string): void;
    part(channel: string, message?: string): void;
    say(target: string, message: string): void;
    quit(message?: string): void;
    
    on(event: 'registered', listener: () => void): this;
    on(event: 'message', listener: (event: MessageEvent) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}
