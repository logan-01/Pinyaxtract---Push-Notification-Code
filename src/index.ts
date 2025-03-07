import { Expo, ExpoPushTicket, ExpoPushReceiptId } from "expo-server-sdk";
import * as admin from "firebase-admin";
import * as dotenv from "dotenv";

const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Load environment variables
dotenv.config();

// Parse Firebase service account JSON from .env
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");

// Ensure private_key has proper newlines
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount), // Explicit typing
  databaseURL:
    "https://pinyaxtract-default-rtdb.asia-southeast1.firebasedatabase.app",
});

// * Initialize Realtime Database and Firestore
const database = admin.database();
const firestore = admin.firestore();
// * RTDB Reference
const temperatureRef = database.ref("Temperature");
const fanRef = database.ref("Fan");
// * Threshold and States
const lowTempVal = 65;
const highTempVal = 70;
let isNormalNotified = false;

async function getExpoTokens(): Promise<string[]> {
  try {
    const usersCollection = firestore.collection("users");
    const usersSnapshot = await usersCollection.get();
    const tokensSet = new Set<string>();
    // const tokenRaw: string[] = [];

    usersSnapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      if (userData && Array.isArray(userData.expoPushTokens)) {
        userData.expoPushTokens.forEach((token: string) => {
          tokensSet.add(token);
          // tokenRaw.push(token);
        });
      }
    });

    const tokensArray = Array.from(tokensSet);
    // console.log("Expo Push Tokens:", tokensArray);
    return tokensArray;
  } catch (error) {
    console.error("Error retrieving tokens:", error);
    return [];
  }
}

async function storeNotification(title: string, body: string) {
  try {
    const parseTitle = title.replace(/^\S+\s+/, "");
    const type = parseTitle === "Overheating Alert!" ? "danger" : "normal";

    await firestore.collection("notifications").add({
      title: parseTitle,
      body,
      type,
      timestamp: admin.firestore.FieldValue.serverTimestamp(), // Store server timestamp
    });
    console.log("Notification stored in Firestore");
  } catch (error) {
    console.error("Error storing notification:", error);
  }
}

// Create a new Expo SDK client
let expo = new Expo({ useFcmV1: true });

async function sendPushNotification(title: string, body: string) {
  const tokenArray: string[] = await getExpoTokens();
  if (tokenArray.length === 0) return;

  let messages = [];

  for (let token of tokenArray) {
    //Check Token if a valid Expo Token
    if (!Expo.isExpoPushToken(token)) {
      console.error(`Push token ${token} is not a valid Expo push token`);
      continue;
    }

    //Send the actual notification
    messages.push({
      to: token,
      sound: "default",
      title,
      body,
      //   data: { withSome: "data" },
    });
  }

  //   Sending Notification in Batch
  let chunks = expo.chunkPushNotifications(messages);
  let tickets: ExpoPushTicket[] = [];

  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log(ticketChunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error(error);
    }
  }

  // Verfied if Notification is send succesfully
  let receiptIds: ExpoPushReceiptId[] = [];
  for (let ticket of tickets) {
    if (ticket.status === "ok") {
      receiptIds.push(ticket.id);
    }
  }

  let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

  for (let chunk of receiptIdChunks) {
    try {
      let receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      console.log(receipts);

      for (let receiptId in receipts) {
        let { status, details } = receipts[receiptId];
        if (status === "ok") {
          continue;
        } else if (status === "error") {
          console.error(
            `There was an error sending a notification: ${
              (details as any).error
            }`
          );
          if (details && "error" in details) {
            console.error(
              `The error code is ${(details as { error: string }).error}`
            );
          }
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  // Store notification in Firestore after successfully sending
  await storeNotification(title, body);
}

//* Send Push Notification Based on Temperature Value
temperatureRef.on("value", async (snapshot) => {
  const tempVal = snapshot ? snapshot.val() : 0;

  // Check Fan State
  const fanSnapshot = await fanRef.once("value");
  const fanState = fanSnapshot.val();

  // * Send Message when the Temperature is High
  if (tempVal >= highTempVal && !fanState) {
    const overheatingMessage = {
      title: "⚠️  Overheating Alert!",
      body: "High temperature detected! Shut down machine immediately and wait 40 minutes before restarting to prevent damage.",
    };
    await sendPushNotification(
      overheatingMessage.title,
      overheatingMessage.body
    );
    isNormalNotified = false;
  }

  // * Send Message when the Temperature is Back to Normal (Only Once)
  if (tempVal <= lowTempVal && !isNormalNotified) {
    const normalTempMessage = {
      title: "✅  Temperature Stabilized",
      body: "The machine is now within a safe temperature range. You can restart the machine now if needed.",
    };
    await sendPushNotification(normalTempMessage.title, normalTempMessage.body);
    isNormalNotified = true;
  }
});

// * To Keep FCM Awake
app.get("/", (req: any, res: any) => {
  res.send("App is awake!");
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
