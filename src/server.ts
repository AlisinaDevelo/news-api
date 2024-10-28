import "dotenv/config";
import app from "./app";
import { requireApiKeyUnlessTest } from "./config/env";

requireApiKeyUnlessTest();

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`server running on ${PORT}!`);
});