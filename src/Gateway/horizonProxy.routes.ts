import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { horizonProxyService, HorizonProxyError } from "./horizonProxy.service";
import logger from "../config/logger";

const router = Router();

router.get("/proxy", authenticateToken, async (req: Request, res: Response) => {
  try {
    const path = String(req.query.path || "");
    const query = { ...req.query };
    delete query.path;

    const data = await horizonProxyService.proxyGet(
      path,
      query as Record<string, string | string[] | undefined>
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proxy request failed";

    logger.warn("Horizon proxy request failed", {
      error: message,
      userId: req.user?.userId,
      path: req.query.path,
    });

    if (error instanceof HorizonProxyError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal proxy error",
    });
  }
});

export default router;
