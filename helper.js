const cloudinary = require("cloudinary").v2

const uploadBufferToCloudinary = (file) => {
    return new Promise((resolve, reject)=>{
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
        cloudinary.uploader.upload_stream(
            {
                resource_type: "raw",
                folder: "my_uploads",
                public_id: file.originalname,
                access_mode: "public"
            },
            (error, result)=> {
                if(error) return reject(error)
                resolve(result)
            }
        ).end(file.buffer)
    })
}

module.exports = uploadBufferToCloudinary