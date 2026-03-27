export default async function (ctx) {
    const req = ctx.request;
    const url = req.url;
    // const method = req.method;
    const resp = ctx.response;
    if (!resp.body) {
        ctx.notify({ title: "Zhihu", body: `empty response body for ${url}` })
        return { body: '{}' }
    }

    let body = await resp.json() ?? {};

    if (url.includes("api.zhihu.com/commercial_api/real_time_launch_v2")) {
        try {
            let launch = JSON.parse(body.launch);
            if ('ads' in launch) {
                launch.ads = [];
            }
            body.launch = JSON.stringify(launch);
        } catch (e) {
            ctx.notify({ title: "Zhihu", body: `failed to parse launch ${String(e)}` })
        }
    }

    return { body: body };
}