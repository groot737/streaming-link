//https://consumet-eta-five.vercel.app/

import axios from "axios";

/*
Using the example episode ID of 'spy-x-family-episode-1',
explicitly defining default server for demostrative purposes.
*/
const serversUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/servers";
const watchUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/watch";

const data = async () => {
    try {
        // 1. Get the list of servers
        const { data: servers } = await axios.get(serversUrl, {
            params: { episodeId: "10766", mediaId: "tv/watch-rick-and-morty-39480" }
        });

        console.log("Servers:", servers);

        // 2. Find the 'upcloud' server (or use the first one)
        const upcloud = servers.find(s => s.name === "upcloud");

        if (!upcloud) {
            throw new Error("Upcloud server not found");
        }

        console.log("Selected Server:", upcloud);

        // 3. Get the streaming link
        // Attempt 1: Use the original episodeId and the server's unique ID as 'server'
        console.log(`Fetching stream with episodeId: 10766 and server: ${upcloud.id} (name: ${upcloud.name})...`);

        try {
            const { data: streamData } = await axios.get(watchUrl, {
                params: {
                    episodeId: "10766",
                    mediaId: "tv/watch-rick-and-morty-39480",
                    server: upcloud.name // Try name first, usually 'upcloud' or 'vidcloud'
                }
            });
            console.log("Success with server name!");
            return streamData;
        } catch (error) {
            console.log("Failed with server name, trying server ID...");
            const { data: streamData } = await axios.get(watchUrl, {
                params: {
                    episodeId: "10766",
                    mediaId: "tv/watch-rick-and-morty-39480",
                    server: upcloud.id
                }
            });
            console.log("Success with server ID!");
            return streamData;
        }
    } catch (err) {
        throw new Error(err.message);
    }
};

data().then(res => console.log(res)).catch(err => console.error(err));
