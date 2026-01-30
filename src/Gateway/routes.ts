import { Router, Request, Response } from "express";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import { stellarWebhookService } from "./webhook.service";

const router = Router();

// Public webhook endpoint for Stellar funding notifications
router.post("/webhook/stellar/funding", async (req: Request, res: Response) => {
  try {
    const result = await stellarWebhookService.processFundingWebhook(req);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        userId: result.userId,
        deploymentTriggered: result.deploymentTriggered,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name, address, pk } = req.body;

    // Validate required fields
    if (!name || !address || !pk) {
      return res.status(400).json({
        success: false,
        message: "name, address, and pk are required",
      });
    }

    const userRepository = AppDataSource.getRepository(User);

    // Check for existing user (name is unique)
    const existingUser = await userRepository.findOne({
      where: { name },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this name already exists",
      });
    }

    // Create user
    const user = userRepository.create({
      name,
      address,
      pk,
      // isDeployed and tokenType will use defaults
    });

    // Save user
    const savedUser = await userRepository.save(user);

    //  Return success
    return res.status(201).json({
      success: true,
      userId: savedUser.id,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
