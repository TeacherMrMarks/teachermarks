/* Bundle browser helper — QR code is rendered locally, no banking data sent elsewhere. */
import QRCode from 'qrcode';
globalThis.TM391Qr={render(text,canvas){return QRCode.toCanvas(canvas,text,{width:220,margin:2,color:{dark:'#112f44',light:'#ffffff'},errorCorrectionLevel:'M'})}};
