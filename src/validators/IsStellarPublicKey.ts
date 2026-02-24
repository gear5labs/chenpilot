import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { StrKey } from "@stellar/stellar-sdk";

@ValidatorConstraint({ async: false })
export class IsStellarPublicKeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;

    try {
      return StrKey.isValidEd25519PublicKey(value);
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "Invalid Stellar public key format";
  }
}

export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isStellarPublicKey",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsStellarPublicKeyConstraint,
    });
  };
}
