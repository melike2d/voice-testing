import "../logging.ts";
import { createGateway, createVoiceGateway, VoiceGatewayInfo, holepunch, xsalsa20_poly1305, env } from "../core/mod.ts";
import { GatewayOpcodes } from "https://deno.land/x/discord_api_types@0.36.1/gateway/v10.ts";
import { logger } from "../deps.ts";
import { startFfmpegTest } from "./common.ts";

const log = logger.getLogger("discord");

/* get the IDs to use for a voice connection */
const GUILD_ID   = env("GUILD_ID")
    , CHANNEL_ID = env("CHANNEL_ID");

/* create a new gateway instance. */
const gateway = await createGateway(Deno.env.get("BOT_TOKEN")!);

let voice: Partial<VoiceGatewayInfo> = {};
function checkCanConnectVoice() {
    if (voice.server && voice.state) {
        runVoice(voice as VoiceGatewayInfo)
        voice = {}
    }
}

gateway.state.events.on("dispatch", payload => {
    if (payload.t === "VOICE_SERVER_UPDATE") {
        voice.server = payload.d;
        checkCanConnectVoice()
    } else if (payload.t === "VOICE_STATE_UPDATE") {
        if (payload.d.user_id !== gateway.state.self?.id) {
            return;
        }

        voice.state = payload.d;
        checkCanConnectVoice()
    }
});

/* send voice state update. */
await gateway.send({
    op: GatewayOpcodes.VoiceStateUpdate,
    d: {
        guild_id: GUILD_ID,
        channel_id: CHANNEL_ID,
        self_deaf: true,
        self_mute: false
    }
});

async function runVoice(voice: VoiceGatewayInfo) {
    const gateway = await createVoiceGateway(voice);

    gateway.state.events.on("ready", async () => {
        const { ip, port } = await holepunch(gateway.state.ssrc!, gateway.state.transport!);

        /* select protocol */
        log.info(`performed holepunch: ${ip}:${port}`);

        gateway.send({
            op: 1,
            d: {
                protocol: "udp",
                data: {
                    address: ip, port,
                    mode: "xsalsa20_poly1305_suffix"
                },
            }
        });
    });

    gateway.state.events.on("session_description", async secretKey => {
        await startFfmpegTest({
            transport: gateway.state.transport!,
            ssrc: gateway.state.ssrc!,
            encryptionStrategy: await xsalsa20_poly1305.create(secretKey, xsalsa20_poly1305.createSuffixNonceStrategy()),
            updateSpeaking: value => gateway.send({
                op: 5,
                d: {
                    speaking: value ? 1 << 0 : 0,
                    delay: 0,
                    ssrc: gateway.state.ssrc!
                }
            })
        })
    });
}