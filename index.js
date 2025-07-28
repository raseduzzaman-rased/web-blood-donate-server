const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ChangeStream,
} = require("mongodb");

var admin = require("firebase-admin");

var serviceAccount = require("./admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// const serviceAccount = require("./admin-key.json");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("🚀 ~ verifyFirebaseToken ~ authHeader:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decodedToken; // You can access user info like uid, email, etc.
    next();
  } catch (error) {
    console.log(error);
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid token from catch" });
  }
};

async function run() {
  try {
    await client.connect();
    const db = client.db("db_name");
    const booksCollection = db.collection("books");
    const userCollection = db.collection("users");
    const donationCollection = db.collection("donationRequests");

    const verifyAdmin = async (req, res, next) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });

      if (user.role === "admin") {
        next();
      } else {
        res.status(403).send({ msg: "unauthorized" });
      }
    };


app.post("/donation-requests", verifyFirebaseToken, async (req, res) => {
  const userEmail = req.firebaseUser.email;
  const user = await userCollection.findOne({ email: userEmail });

  if (!user || user.status !== "active") {
    return res.status(403).json({ message: "Blocked users cannot create requests" });
  }

  const requestData = req.body;
  requestData.requesterEmail = userEmail;
  requestData.status = "pending"; // force status to "pending"
  requestData.createdAt = new Date();

  const result = await donationCollection.insertOne(requestData);
  res.send(result);
});



app.get("/donation-requests", verifyFirebaseToken, async (req, res) => {
  const email = req.query.email;
  const limit = parseInt(req.query.limit) || 0;

  const query = { requesterEmail: email };
  const cursor = donationCollection.find(query).sort({ createdAt: -1 });
  const donations = limit > 0 ? await cursor.limit(limit).toArray() : await cursor.toArray();

  res.send(donations);
});



app.get("/my-donation-requests", verifyFirebaseToken, async (req, res) => {
  const email = req.firebaseUser.email;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 5;
  const status = req.query.status;

  const query = { requesterEmail: email };
  if (status && status !== "all") {
    query.status = status;
  }

  const total = await donationCollection.countDocuments(query);
  const donations = await donationCollection
    .find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  res.send({ donations, total });
});



app.delete("/donation-requests/:id", verifyFirebaseToken, async (req, res) => {
  const id = req.params.id;
  const result = await donationCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});


// Get a single donation request by ID
app.get("/donation-requests/:id", verifyFirebaseToken, async (req, res) => {
  const { id } = req.params;
  try {
    const donation = await donationCollection.findOne({ _id: new ObjectId(id) });
    if (!donation) return res.status(404).json({ message: "Donation not found" });
    res.send(donation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching donation" });
  }
});

// Update a donation request
app.patch("/donation-requests/:id", verifyFirebaseToken, async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  try {
    const result = await donationCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
});





    // 1️⃣ Get User Profile
    app.get("/user/profile", verifyFirebaseToken, async (req, res) => {
      const email = req.firebaseUser.email;

      try {
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found." });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 2️⃣ Update User Profile
    app.patch("/user/profile", verifyFirebaseToken, async (req, res) => {
      const email = req.firebaseUser.email;
      const updateData = req.body; // should contain updated fields

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: updateData }
        );

        res.send(result);
      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ message: "Failed to update profile" });
      }
    });

    app.post("/add-book", async (req, res) => {
      // Book Title, Cover Image, Author Name, Genre, Pickup Location, Available Until
      const data = req.body;
      const result = await booksCollection.insertOne(data);
      res.send(result);
    });

    app.post("/add-user", async (req, res) => {
      const userData = req.body;

      const existingUser = await userCollection.findOne({
        email: userData.email,
      });

      if (existingUser) {
        const updateResult = await userCollection.updateOne(
          { email: userData.email },
          {
            $set: {
              name: userData.name,
              photo: userData.photo,
              blood: userData.blood,
            },
            $inc: { loginCount: 1 },
          }
        );
        return res.send({ msg: "User updated", updated: updateResult });
      } else {
        const result = await userCollection.insertOne({
          ...userData,
          role: "donor",
          status: "active",
          createdAt: new Date(),
        });
        return res.send({ msg: "New user created", inserted: result });
      }
    });

    app.get("/get-user-role", verifyFirebaseToken, async (req, res) => {
      const email = req?.firebaseUser?.email;
      const query = { email };

      const user = await userCollection.findOne(query);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.send({
        role: user.role || "donor",
        status: user.status || "active",
        name: user.name,
        photo: user.photo,
      });
    });

    // app.get(
    //   "/get-users",
    //   verifyFirebaseToken,
    //   verifyAdmin,
    //   async (req, res) => {
    //     const users = await userCollection
    //       .find({ email: { $ne: req.firebaseUser.email } })
    //       .toArray();
    //     res.send(users);
    //   }
    // );

    app.get("/get-users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;

  const query = { email: { $ne: req.firebaseUser.email } };
  if (status && status !== "all") {
    query.status = status;
  }

  const total = await userCollection.countDocuments(query);
  const users = await userCollection
    .find(query)
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit))
    .toArray();

  res.send({ users, total });
});


    app.patch(
      "/update-role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { email, role } = req.body;
        const result = await userCollection.updateOne(
          { email: email },
          {
            $set: { role },
          }
        );

        res.send(result);
      }
    );


    app.patch("/update-status", verifyFirebaseToken, verifyAdmin, async (req, res) => {
  const { email, status } = req.body;

  if (!email || !status) {
    return res.status(400).json({ message: "Email and status required" });
  }

  const result = await userCollection.updateOne(
    { email },
    { $set: { status } }
  );

  res.send(result);
});


    app.get("/available-books", async (req, res) => {
      const data = await booksCollection
        .find({ status: "available" })
        .toArray();
      res.send(data);
    });

    app.get("/featured-books", async (req, res) => {
      const data = await booksCollection
        .find({ status: "available" })
        .sort({ createdAt: -1 })
        .limit(4)
        .toArray();
      res.send(data);
    });

    app.get("/my-books", verifyFirebaseToken, async (req, res) => {
      const { page, filter } = req.query;
      const query = { ownerEmail: req.firebaseUser.email };

      if (filter && filter !== "all") {
        query.status = filter;
      }
      const totalCount = await booksCollection.countDocuments(query);
      const data = await booksCollection
        .find(query)
        .skip((page - 1) * 3)
        .limit(3)
        .toArray();
      res.send({ books: data, totalCount });
    });

    app.get("/details/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const data = await booksCollection.findOne(query);
      res.send(data);
    });

    app.patch("/request/:id", verifyFirebaseToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const { donationAmount } = req.body;
      const data = await booksCollection.updateOne(query, {
        $set: {
          status: "requested",
          requestedBy: req.firebaseUser.email,
          donationAmount,
        },
      });
      res.send(data);
    });

    app.get("/admin-dashboard-stats", async (req, res) => {
      const userCount = await userCollection.countDocuments();
      const bookCount = await booksCollection.countDocuments();
      const bookRequestCount = await booksCollection.countDocuments({
        status: "requested",
      });

      res.send({
        totalUsers: userCount,
        totalBooks: bookCount,
        totalRequest: bookRequestCount,
      });
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // in cents (e.g., 500 = $5.00)
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    console.log("connected");
  } finally {
  }
}

run().catch(console.dir);

// Root route
app.get("/", async (req, res) => {
  res.send({ msg: "hello" });
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

/*
1. authorization
*/
