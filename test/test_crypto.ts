import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import * as should from "should";
import {
    DER,
    PublicKey,
    PublicKeyPEM,
    rsa_length,
    convertPEMtoDER,
    RSA_PKCS1_OAEP_PADDING,
    RSA_PKCS1_PADDING,
    publicEncrypt_long,
    privateDecrypt_long,
    makeMessageChunkSignature,
    verifyMessageChunkSignature,
    toPem,
    extractPublicKeyFromCertificate,
    publicEncrypt,
} from "../source";
import {
    setCertificateStore,
    readPrivateKey,
    readCertificate,
    readPublicKey,
    read_sshkey_as_pem,
    readPrivateRsaKey,
} from "../source_nodejs";

import * as loremIpsum1 from "lorem-ipsum";
const loremIpsum = (loremIpsum1 as any).loremIpsum({ count: 100 });

// tslint:disable-next-line:unused-constant
const should_ = should;

// see https://github.com/nodejs/node/issues/22815

let old_store: string | null = null;

function switch_to_test_certificate_store() {
    assert(old_store === null);
    old_store = setCertificateStore(path.join(__dirname, "./fixtures/certs/"));
}

function restore_default_certificate_store() {
    if (old_store === null) {
        throw new Error("cannot restore certificate store");
    }

    setCertificateStore(old_store);
    old_store = null;
}

const alice_private_key_filename = path.join(__dirname, "./fixtures/alice_bob/alice_key_1024.pem");
const alice_public_key_filename = path.join(__dirname, "./fixtures/alice_bob/alice_public_key_1024.pub");
const alice_certificate_filename = path.join(__dirname, "./fixtures/alice_bob/alice_cert_1024.pem");
const alice_out_of_date_certificate_filename = path.join(__dirname, "./fixtures/alice_bob/alice_cert_1024_outofdate.pem");

const bob_private_key_filename = path.join(__dirname, "./fixtures/alice_bob/bob_key_1024.pem");
const bob_public_key_filename = path.join(__dirname, "./fixtures/alice_bob/bob_public_key_1024.pub");
const bob_certificate_filename = path.join(__dirname, "./fixtures/alice_bob/bob_cert_1024.pem");
const bob_certificate_out_of_date_filename = path.join(__dirname, "./fixtures/alice_bob/bob_cert_1024_outofdate.pem");

const doDebug = false;

//Xx doDebug = true;
function debugLog(...args: [any?, ...any[]]) {
    if (doDebug) {
        console.log(console, ...args);
    }
}
const c = crypto.createCipheriv;;
(crypto as any).createCipheriv = (algorithm: any,key: any,iv: any)=> { 
    console.log("aa=",key,algorithm);
    console.log('p', iv.length);
    return c(algorithm,key,iv); 
};

// symmetric encryption and decryption
function encrypt_buffer(buffer: Buffer, algorithm: string, key: Buffer): Buffer {
    const iv = Buffer.alloc(16, 0); // Initialization vector.
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted_chunks = [];
    encrypted_chunks.push(cipher.update(buffer));
    encrypted_chunks.push(cipher.final());
    return Buffer.concat(encrypted_chunks);
}

function decrypt_buffer(buffer: Buffer, algorithm: string, key:  Buffer): Buffer {
    const iv = Buffer.alloc(16, 0); // Initialization vector.
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted_chunks = [];
    decrypted_chunks.push(decipher.update(buffer));
    decrypted_chunks.push(decipher.final());
    return Buffer.concat(decrypted_chunks);
}

//  ursa only work with node version <= 0.10
//  however crypto.publicEncrypt only appear in node > 0.11.14
//describe("testing publicEncrypt / privateDecrypt native and ursa",function(){
//
//    it("publicEncrypt_native and  privateDecrypt_native" ,function(){
//
//        const bob_public_key  = read_sshkey_as_pem('bob_id_rsa.pub');
//
//        const message = Buffer.alloc("Hello World");
//
//        const encrypted_native =  publicEncrypt_native(message,bob_public_key);
//        const encrypted_ursa   =  publicEncrypt_ursa(message,bob_public_key);
//
//        encrypted_native.should.eql(encrypted_ursa);
//
//    });
//
//});

//describe("testing RSA_PKCS1_V15 asymmetric encryption", function() {
//
//    it("should encrypt and decrypt with RSA_PKCS1_V15",function(){
//        const algorithm = "RSA-PKCS1-V15";
//        const bob_public_key     = read_sshkey_as_pem('bob_id_rsa.pub');
//
//        const message = "Hello World";
//
//        const encrypted_message = encrypt_buffer(message,algorithm ,bob_public_key);
//
//        const bob_private_key = read_private_rsa_key('bob_id_rsa');
//        const decrypted_message = decrypt_buffer(encrypted_message,algorithm,bob_private_key);
//
//        decrypted_message.should.eql(message);
//
//    });
//});

describe("testing and exploring the NodeJS crypto api", function () {
    beforeEach(function (done) {
        switch_to_test_certificate_store();
        done();
    });
    afterEach(function (done) {
        restore_default_certificate_store();
        done();
    });

    it("should be possible to sign a message and verify the signature of a message", function () {
        // ------------------- this is Alice
        //
        // alice want to send a message to Bob
        const message = "HelloWorld";

        // alice will sign her message to bob with her private key.
        const alice_private_key_pem = fs.readFileSync(alice_private_key_filename);
        const alice_private_key = alice_private_key_pem.toString("ascii");
        debugLog(alice_private_key);

        const signature = crypto.createSign("RSA-SHA256").update(message).sign(alice_private_key);

        debugLog("message   = ", message);
        debugLog("signature = ", signature.toString("hex"));

        // ------------------- this is Bob
        // Bob has received a message from Alice,
        // He wants to verify that the message is really from by Alice.
        // Alice has given Bob her public_key.
        // Bob uses Alice's public key to verify that the message is correct

        const message_from_alice = "HelloWorld";

        const alice_public_key = fs.readFileSync(alice_public_key_filename, "ascii");

        crypto.createVerify("RSA-SHA256").update(message_from_alice).verify(alice_public_key, signature).should.equal(true);

        // -------------------------
        crypto.createVerify("RSA-SHA256").update("Hello**HACK**World").verify(alice_public_key, signature).should.equal(false);

        // The keys are asymmetrical, this means that Bob cannot sign
        // a message using alice public key.
        should(function () {
            const bob_sign = crypto.createSign("RSA-SHA256");
            bob_sign.update("HelloWorld");
            const signature1 = bob_sign.sign(alice_public_key);

            signature1.length.should.be.greaterThan(0);
            //xx console.log("buffer length= ", signature.length);
            //xx console.log("buffer= ", signature.toString("hex"));
        }).throwError();
    });

    if (crypto.publicEncrypt !== null) {
        it("should check that bob rsa key is 2048bit long (256 bytes)", function () {
            const key: PublicKeyPEM = read_sshkey_as_pem("bob_id_rsa.pub");
            rsa_length(key).should.equal(256);

            const keyDer: PublicKey = convertPEMtoDER(key);
            rsa_length(keyDer).should.equal(256);
        });

        it("should check that john rsa key is 1024bit long (128 bytes)", function () {
            const key: PublicKeyPEM = read_sshkey_as_pem("john_id_rsa.pub");
            rsa_length(key).should.equal(128);

            const keyDer: PublicKey = convertPEMtoDER(key);
            rsa_length(keyDer).should.equal(128);
        });
        it("RSA_PKCS1_OAEP_PADDING 1024 verifying that RSA publicEncrypt cannot encrypt buffer bigger than 215 bytes due to the effect of padding", function () {
            const john_public_key: PublicKeyPEM = read_sshkey_as_pem("john_id_rsa.pub"); // 1024 bit RSA
            debugLog("john_public_key", john_public_key);
            let encryptedBuffer;

            // since bob key is a 2048-RSA, encrypted buffer will be 2048-bits = 256-bytes long
            // Padding is 41 or 11 and added at the start of the buffer
            // so the max length of the input buffer sent to RSA_public_encrypt() is:
            //      128 - 42 = 215 with RSA_PKCS1_OAEP_PADDING

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(1), john_public_key);
            debugLog(" A encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(128);

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(128 - 42), john_public_key);
            debugLog(" B encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(128);

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(128 - 42 + 1), john_public_key, RSA_PKCS1_OAEP_PADDING);
                debugLog(" C encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(128), john_public_key, RSA_PKCS1_OAEP_PADDING);
                console.log(" D encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();
        });

        it("RSA_PKCS1_PADDING 2048 verifying that RSA publicEncrypt cannot encrypt buffer bigger than 215 bytes due to the effect of padding", function () {
            //
            const bob_public_key: PublicKeyPEM = read_sshkey_as_pem("bob_id_rsa.pub");
            debugLog("bob_public_key", bob_public_key);
            let encryptedBuffer;

            // since bob key is a 2048-RSA, encrypted buffer will be 2048-bits = 256-bytes long
            // Padding is 41 or 11 and added at the start of the buffer
            // so the max length of the input buffer sent to RSA_public_encrypt() is:
            //      256 - 42 = 214 with RSA_PKCS1_OAEP_PADDING
            //      256 - 11 = 245 with RSA_PKCS1_PADDING

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(1), bob_public_key, RSA_PKCS1_PADDING);
            debugLog(" A encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(256);

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(245), bob_public_key, RSA_PKCS1_PADDING);
            debugLog(" B encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(256);

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(246), bob_public_key, RSA_PKCS1_PADDING);
                debugLog(" C encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(259), bob_public_key, RSA_PKCS1_PADDING);
                console.log(" D encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();
        });

        it("RSA_PKCS1_OAEP_PADDING 2048 verifying that RSA publicEncrypt cannot encrypt buffer bigger than 215 bytes due to the effect of padding", function () {
            //
            const bob_public_key = read_sshkey_as_pem("bob_id_rsa.pub");
            debugLog("bob_public_key", bob_public_key);
            let encryptedBuffer;

            // since bob key is a 2048-RSA, encrypted buffer will be 2048-bits = 256-bytes long
            // Padding is 41 or 11 and added at the start of the buffer
            // so the max length of the input buffer sent to RSA_public_encrypt() is:
            //      256 - 42 = 214 with RSA_PKCS1_OAEP_PADDING
            //      256 - 11 = 245 with RSA_PKCS1_PADDING

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(1), bob_public_key, RSA_PKCS1_OAEP_PADDING);
            debugLog(" A encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(256);

            encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(214), bob_public_key, RSA_PKCS1_OAEP_PADDING);
            debugLog(" B encryptedBuffer length = ", encryptedBuffer.length);
            encryptedBuffer.length.should.eql(256);

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(215), bob_public_key, RSA_PKCS1_OAEP_PADDING);
                debugLog(" C encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();

            should(function () {
                encryptedBuffer = publicEncrypt(Buffer.allocUnsafe(259), bob_public_key, RSA_PKCS1_OAEP_PADDING);
                console.log(" D encryptedBuffer length = ", encryptedBuffer.length);
                //xx encryptedBuffer.length.should.eql(128);
            }).throwError();
        });

        it("publicEncrypt  shall produce  different encrypted string if call many times with the same input", function () {
            //xx            const bob_public_key = readCertificate('test/fixtures/certs/alice_cert_1024.pem'); // 2048bit long key
            const bob_public_key = read_sshkey_as_pem("bob_id_rsa.pub"); // 2048bit long key
            const bob_private_key = readPrivateRsaKey("bob_id_rsa");

            const initialBuffer = Buffer.from(loremIpsum.substr(0, 25));
            const encryptedBuffer1 = publicEncrypt_long(initialBuffer, bob_public_key, 256, 11);
            const encryptedBuffer2 = publicEncrypt_long(initialBuffer, bob_public_key, 256, 11);

            encryptedBuffer1.toString("hex").should.not.equal(encryptedBuffer2.toString("hex"));

            const decryptedBuffer1 = privateDecrypt_long(encryptedBuffer1, bob_private_key, 256);
            const decryptedBuffer2 = privateDecrypt_long(encryptedBuffer2, bob_private_key, 256);

            decryptedBuffer1.toString("hex").should.equal(decryptedBuffer2.toString("hex"));
        });

        it("publicEncrypt_long should encrypt a 256 bytes buffer and return a encrypted buffer of 512 bytes", function () {
            const bob_public_key = read_sshkey_as_pem("bob_id_rsa.pub"); // 2048bit long key

            const initialBuffer = Buffer.from(loremIpsum.substr(0, 256));
            const encryptedBuffer = publicEncrypt_long(initialBuffer, bob_public_key, 256, 11);
            encryptedBuffer.length.should.eql(256 * 2);

            const bob_private_key = readPrivateRsaKey("bob_id_rsa");
            const decryptedBuffer = privateDecrypt_long(encryptedBuffer, bob_private_key, 256);
            decryptedBuffer.toString("ascii").should.eql(initialBuffer.toString("ascii"));
        });

        it("publicEncrypt_long should encrypt a 1024 bytes buffer and return a encrypted buffer of 1280 bytes", function () {
            const bob_public_key = read_sshkey_as_pem("bob_id_rsa.pub");

            const initialBuffer = Buffer.from(loremIpsum.substr(0, 1024));
            const encryptedBuffer = publicEncrypt_long(initialBuffer, bob_public_key, 256, 11);
            encryptedBuffer.length.should.eql(256 * 5);

            const bob_private_key = readPrivateRsaKey("bob_id_rsa");
            const decryptedBuffer = privateDecrypt_long(encryptedBuffer, bob_private_key, 256);
            decryptedBuffer.length.should.equal(initialBuffer.length);
            decryptedBuffer.toString("ascii").should.eql(initialBuffer.toString("ascii"));
        });

        it("Alice should be able to encrypt a message with bob's public key and Bob shall be able to decrypt it with his Private Key", function () {
            // see also : http://crypto.stackexchange.com/questions/5458/should-we-sign-then-encrypt-or-encrypt-then-sign

            // ------------------- this is Alice
            //
            // Alice want to send a message to Bob.
            // Alice want bob to be the only person that can read the message.
            // Alice will encrypt her message to bob using bob's public key.
            //
            // she will sign he message first with her private key

            const message = "My dear Bob, " + loremIpsum + "... Alice";
            debugLog("length of original  message = ", message.length);

            const alice_private_key = readPrivateRsaKey("alice_id_rsa");
            const bob_public_key = read_sshkey_as_pem("bob_id_rsa.pub");

            const signature = crypto.createSign("RSA-SHA256").update(message).sign(alice_private_key);
            debugLog("signature = ", signature.toString("hex"));
            debugLog("signature length = ", signature.length);

            debugLog(bob_public_key);

            const encryptedMessage = publicEncrypt_long(Buffer.from(message), bob_public_key, 256, 42);

            debugLog("encrypted message=", encryptedMessage.toString("hex"));

            debugLog("length of encrypted message = ", encryptedMessage.length);

            // ------------------- this is Bob
            // Bob has received a encrypted message from Alice.

            // Bob must first decipher the message using its own private key

            const bob_private_key = readPrivateRsaKey("bob_id_rsa");
            const alice_public_key = read_sshkey_as_pem("alice_id_rsa.pub");

            //xx encryptedMessage += "q";

            const decryptedMessage = privateDecrypt_long(encryptedMessage, bob_private_key, 256).toString();
            debugLog("decrypted message=", decryptedMessage.toString());

            // then Bob must also verify that the signature is matching
            crypto.createVerify("RSA-SHA256").update(decryptedMessage).verify(alice_public_key, signature).should.equal(true);

            // He wants to verify that the message is really from by Alice.
            // Alice has given Bob her public_key.
            // Bob uses Alice's public key to verify that the message is correct
        });
    }

    it("explore DiffieHellman encryption (generating keys)", function () {
        const alice = crypto.getDiffieHellman("modp5");
        const bob = crypto.getDiffieHellman("modp5");

        alice.generateKeys();
        bob.generateKeys();

        const alice_secret = alice.computeSecret(bob.getPublicKey(), "hex");
        const bob_secret = bob.computeSecret(alice.getPublicKey(), "hex");

        /* alice_secret and bob_secret should be the same */
        alice_secret.should.eql(bob_secret);
    });

    // encrypt_buffer(buffer,"aes-256-cbc",key);
    it("should encrypt a message", function () {
        // http://stackoverflow.com/questions/8750780/encrypting-data-with-public-key-in-node-js
        // http://slproweb.com/products/Win32OpenSSL.html
        const key = crypto.randomBytes(32);

        const bufferToEncrypt = Buffer.alloc(32);
        bufferToEncrypt.writeDoubleLE(3.14, 0);
        bufferToEncrypt.writeDoubleLE(3.14, 8);

        const encryptedBuf = encrypt_buffer(bufferToEncrypt, "aes-256-cbc", key);

        if (!fs.existsSync("tmp")) {
            fs.mkdirSync("tmp");
        }
        const s = fs.createWriteStream("tmp/output2.bin", "ascii");
        s.write(encryptedBuf.toString("hex"));
        s.end();
    });

    it("exploring crypto api with symmetrical encryption/decryption", function () {
        const key = crypto.randomBytes(32);

        const bufferToEncrypt = Buffer.from("This is a top , very top secret message !! ah ah" + loremIpsum);

        const encryptedBuffer = encrypt_buffer(bufferToEncrypt, "aes-256-cbc", key);
        const decryptedBuffer = decrypt_buffer(encryptedBuffer, "aes-256-cbc", key);

        // xx console.log("encrypted  %d :", encrypted_buff.length,encrypted_buff.toString("hex"));
        // xx console.log("decrypted  %d :", decrypted_buff.length,decrypted_buff.toString("hex"));
        // xx console.log("decrypted  %d :", buffer.length,buffer.toString("hex"));
        bufferToEncrypt.toString("hex").should.equal(decryptedBuffer.toString("hex"));
    });
});

describe("exploring symmetric signing", function () {
    it("should sign and verify", function () {
        const text = "I love cupcakes",
            key = crypto.randomBytes(32);

        const hash = crypto.createHmac("sha1", key).update(text).digest();

        assert(hash instanceof Buffer);
        //xx console.log(hash.toString("hex"), hash.length);

        hash.length.should.eql(20);
        // TO DO : to be completed.
    });
});

/// -------------------------------------------------------------

// openssl genrsa -out certs/server/my-server.key.pem 2048
// openssl rsa -in certs/server/my-server.key.pem -pubout -out certs/client/my-server.pub

// See also:
// https://github.com/coolaj86/nodejs-self-signed-certificate-example
// https://github.com/coolaj86/node-ssl-root-cas/wiki/Painless-Self-Signed-Certificates-in-node.js
// https://github.com/coolaj86/node-ssl-root-cas
// https://github.com/coolaj86/bitcrypt

describe("Testing AsymmetricSignatureAlgorithm", function () {
    const chunk = Buffer.from(loremIpsum);

    // console.log("crypto.getHashes() =" ,crypto.getHashes());

    // crypto.getHashes().forEach(function(a){ make_suite(a,128); });

    function make_suite(algorithm: string, length: number) {
        it("should sign with a private key and verify with the public key (ASCII) - " + algorithm, function () {
            const alice_private_key = fs.readFileSync(alice_private_key_filename, "ascii");
            const options1 = {
                algorithm,
                signatureLength: length,
                privateKey: alice_private_key,
            };
            const signature = makeMessageChunkSignature(chunk, options1);

            signature.should.be.instanceOf(Buffer);
            signature.length.should.eql(options1.signatureLength);

            const alice_public_key = fs.readFileSync(alice_public_key_filename, "ascii");

            const options2 = {
                algorithm,
                signatureLength: length,
                publicKey: alice_public_key,
            };
            const signVerif = verifyMessageChunkSignature(chunk, signature, options2);
            signVerif.should.eql(true);
        });

        it("should sign with a private key and verify with the certificate (ASCII) - " + algorithm, function () {
            const alice_private_key = fs.readFileSync(alice_private_key_filename, "ascii");
            const options1 = {
                algorithm,
                signatureLength: length,
                privateKey: alice_private_key,
            };

            const signature = makeMessageChunkSignature(chunk, options1);

            signature.should.be.instanceOf(Buffer);
            signature.length.should.eql(options1.signatureLength);

            const alice_certificate = fs.readFileSync(alice_certificate_filename, "ascii");

            const options2 = {
                algorithm,
                signatureLength: length,
                publicKey: alice_certificate,
            };
            const signVerif = verifyMessageChunkSignature(chunk, signature, options2);
            signVerif.should.eql(true, "Verification has failed");
        });

        it("should sign with a private key and verify with a OUT OF DATE certificate (ASCII) - " + algorithm, function () {
            const alice_private_key = fs.readFileSync(alice_private_key_filename, "ascii");
            const options1 = {
                algorithm,
                signatureLength: length,
                privateKey: alice_private_key,
            };
            const signature = makeMessageChunkSignature(chunk, options1);

            signature.should.be.instanceOf(Buffer);
            signature.length.should.eql(options1.signatureLength);

            const alice_certificate = fs.readFileSync(alice_out_of_date_certificate_filename).toString("ascii");

            const options2 = {
                algorithm,
                signatureLength: length,
                publicKey: alice_certificate,
            };
            const signVerif = verifyMessageChunkSignature(chunk, signature, options2);
            signVerif.should.eql(true, "Verification of message chunk signature should succeed signatureLength=" + length);
        });

        it("should sign with a private key and verify with the certificate (DER) - " + algorithm, function () {
            const alice_private_key: DER = readPrivateKey(alice_private_key_filename);
            const options1 = {
                algorithm,
                signatureLength: length,
                privateKey: toPem(alice_private_key, "RSA PRIVATE KEY"),
            };
            const signature = makeMessageChunkSignature(chunk, options1);

            signature.should.be.instanceOf(Buffer);
            signature.length.should.eql(options1.signatureLength);

            const alice_certificate = readCertificate(alice_certificate_filename);

            const options2 = {
                algorithm,
                signatureLength: length,
                publicKey: toPem(alice_certificate, "CERTIFICATE"),
            };
            const signVerif = verifyMessageChunkSignature(chunk, signature, options2);
            signVerif.should.eql(true);
        });

        it("should sign with a other private key and verify with a OUT OF DATE certificate (ASCII) - " + algorithm, function () {
            const private_key = readPrivateKey(bob_private_key_filename);
            const options1 = {
                algorithm,
                signatureLength: length,
                privateKey: toPem(private_key, "RSA PRIVATE KEY"),
            };

            const signature = makeMessageChunkSignature(chunk, options1);

            signature.should.be.instanceOf(Buffer);
            signature.length.should.eql(options1.signatureLength);

            const certificate = readCertificate(bob_certificate_out_of_date_filename);

            const options2 = {
                algorithm,
                signatureLength: length,
                publicKey: toPem(certificate, "CERTIFICATE"),
            };

            const signVerif = verifyMessageChunkSignature(chunk, signature, options2);

            signVerif.should.eql(true);
        });
    }

    make_suite("RSA-SHA384", 128);
    make_suite("RSA-SHA512", 128);
    make_suite("RSA-SHA256", 128);
    make_suite("RSA-SHA1", 128);
    make_suite("RSA-MD4", 128);
    make_suite("sha224WithRSAEncryption", 128);
    make_suite("sha1WithRSAEncryption", 128);
    make_suite("sha256WithRSAEncryption", 128);
});

describe("extractPublicKeyFromCertificate", function () {
    it("should extract a public key from a certificate", function (done) {
        const certificate2 = readCertificate(bob_certificate_filename);

        const publickey2 = readPublicKey(bob_public_key_filename);

        extractPublicKeyFromCertificate(certificate2, (err: Error | null, publicKey?: PublicKeyPEM) => {
            if (!publicKey) {
                return done(new Error("Error"));
            }
            const raw_public_key = convertPEMtoDER(publicKey);

            raw_public_key.toString("base64").should.eql(publickey2.toString("base64"));
            done(err);
        });
    });
});
