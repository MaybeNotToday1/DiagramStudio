export const sampleSql = `-- 班级表
CREATE TABLE t_class_info (
  class_id INT NOT NULL AUTO_INCREMENT COMMENT '班级ID',
  class_name VARCHAR(50) NOT NULL COMMENT '班级名称',
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (class_id)
) COMMENT='班级';

-- 学生表
CREATE TABLE t_student (
  student_id INT NOT NULL AUTO_INCREMENT COMMENT '学生ID',
  student_name VARCHAR(50) NOT NULL COMMENT '学生姓名',
  birthdate DATE COMMENT '出生日期',
  class_id INT COMMENT '班级ID',
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (student_id),
  CONSTRAINT fk_student_class FOREIGN KEY (class_id)
    REFERENCES t_class_info (class_id)
) COMMENT='学生';`
