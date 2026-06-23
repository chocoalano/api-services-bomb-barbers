import { IPaymentGateway } from './interface';
import { MidtransGateway } from './midtrans.gateway';
import { XenditGateway } from './xendit.gateway';

export class GatewayFactory {
  static getGateway(provider: string): IPaymentGateway {
    if (provider === 'midtrans') {
      return new MidtransGateway();
    } else if (provider === 'xendit') {
      return new XenditGateway();
    }
    throw new Error(`Provider gateway '${provider}' tidak didukung atau tidak dikenali.`);
  }
}
