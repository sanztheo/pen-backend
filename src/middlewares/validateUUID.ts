import type { Request, Response, NextFunction } from "express";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateUUID = (...paramNames: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const param of paramNames) {
      const value = req.params[param];
      if (value && !UUID_REGEX.test(value)) {
        return res.status(400).json({
          error: "INVALID_UUID",
          message: `Le paramètre "${param}" doit être un UUID valide`,
        });
      }
    }
    next();
  };
};
