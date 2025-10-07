const express = require('express');
const path = require('path');
const fs = require('fs');
const Syllabus = require('../models/Syllabus');
const Course = require('../models/Course');
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();


router.get('/', async (req, res) => {
  try {
    const { course, semester, branch, search } = req.query;
    let query = { isActive: true };
    
    if (course) query.courseCode = course.toUpperCase();
    if (semester) query.semester = parseInt(semester);
    if (branch) query.branch = branch.toUpperCase();
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const syllabi = await Syllabus.find(query)
      .sort({ courseCode: 1, semester: 1, subject: 1 })
      .populate('uploaderId', 'username email');
    
    res.json(syllabi);
  } catch (error) {
    console.error('Error fetching syllabi:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id)
      .populate('uploaderId', 'username email');
    
    if (!syllabus || !syllabus.isActive) {
      return res.status(404).json({ message: 'Syllabus not found' });
    }
    
    res.json(syllabus);
  } catch (error) {
    console.error('Error fetching syllabus:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.post('/:code', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required' });
    }

    const courseCode = req.params.code.toUpperCase();
    const { semester, subject, title, description, version } = req.body;
    

    const course = await Course.findOne({ code: courseCode, isActive: true });
    if (!course) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Course not found' });
    }

    const syllabus = new Syllabus({
      courseCode,
      branch: course.branch,
      semester: parseInt(semester),
      subject,
      title,
      description,
      filenameOnServer: req.file.filename,
      originalFilename: req.file.originalname,
      fileSize: req.file.size,
      uploaderId: req.admin._id,
      version: version || 1
    });

    await syllabus.save();
    await syllabus.populate('uploaderId', 'username email');
    
    res.status(201).json(syllabus);
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading syllabus:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:id/preview', async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id);
    
    if (!syllabus || !syllabus.isActive) {
      return res.status(404).json({ message: 'File not found' });
    }

    const filePath = path.join(__dirname, '../uploads', syllabus.courseCode, syllabus.filenameOnServer);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    await Syllabus.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${syllabus.originalFilename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error previewing PDF:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:id/download', async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id);
    
    if (!syllabus || !syllabus.isActive) {
      return res.status(404).json({ message: 'File not found' });
    }

    const filePath = path.join(__dirname, '../uploads', syllabus.courseCode, syllabus.filenameOnServer);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    await Syllabus.findByIdAndUpdate(req.params.id, { $inc: { downloadCount: 1 } });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${syllabus.originalFilename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.delete('/:id', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id);
    
    if (!syllabus) {
      return res.status(404).json({ message: 'Syllabus not found' });
    }

    // Check permissions
    if (req.admin.role !== 'superadmin' && !req.admin.assignedCourses.includes(syllabus.courseCode)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filePath = path.join(__dirname, '../uploads', syllabus.courseCode, syllabus.filenameOnServer);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    syllabus.isActive = false;
    await syllabus.save();

    res.json({ message: 'Syllabus deleted successfully' });
  } catch (error) {
    console.error('Error deleting syllabus:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;